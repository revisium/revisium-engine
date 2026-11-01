# Async Row Migration (Shadow Table Pattern)

This document describes the current v1 behaviour; the accepted target design, being implemented, is [async-row-migration-v2](specs/async-row-migration-v2.spec.md).

When `updateTable` is called and the table exceeds the configured row count threshold, rows are migrated asynchronously via a shadow table instead of the synchronous in-transaction path.

This implementation preserves the core ADR-0010 consistency guarantee: readers never observe mixed schema/data state. The schema row is updated only during swap, atomically with switching the draft to the migrated shadow table.

The swap writes what the synchronous `updateTable` writes: the Draft's own copies of the schema and views rows, the
schema history entry and the `update` row of the migration ledger. The Head and earlier revisions never change.

The main intentional v1 deviation is lock scope: the engine currently applies a revision-level write lock during migration, not a table-level write lock. Progress delivery is also polling-only in engine core; SSE/webhooks/event history are not implemented here.

## v1 Deviations from ADR-0010

This implementation is a pragmatic v1 subset of ADR-0010. Key differences:

| ADR-0010                                         | v1 Implementation                                |
| ------------------------------------------------ | ------------------------------------------------ |
| Table-level write lock (other tables writable)   | Revision-level lock (entire draft blocked)       |
| Lock modes: NONE → WRITE → FULL                  | Single mode: all writes blocked during migration |
| SSE/webhooks for progress                        | Polling API only (`getMigrationStatus`)          |
| Migration event history (`MigrationEvent` model) | No event history, only current state             |
| Revert allowed (cancels migration)               | Revert allowed (cancels migration)               |
| Schema update at swap time                       | Schema update at swap time (atomic)              |

Revision-level lock was chosen for v1 simplicity. Table-level lock would require the engine to distinguish writes that target the migrating table from writes that target other tables in the same draft. Future versions can narrow the lock scope.

## How It Works

```text
updateTable(revisionId, tableId, patches)
        |
        v
  row count >= threshold?
   no |          | yes
      v          v
  sync path    async path
  (existing)   (shadow table)
```

### Sync path (existing, unchanged)

All rows loaded into memory, schema patches applied, rows updated — single serializable transaction. Works for tables up to ~1000 rows.

### Async path (new)

```text
PHASE 1: START (serializable transaction)
  ├─ validate revision is draft
  ├─ validate schema patches
  ├─ create TableMigration record (PENDING, payload envelope)
  └─ transaction commits (schema row NOT updated yet)

CLAIM: the owner writes a fresh claim token into lockedBy

PHASE 2: INIT (one transaction, T-init)
  ├─ PENDING and token → COPYING, startedAt (first time only)
  └─ create and record the shadow table (createdId, createdAt, system of the source)

PHASE 3: COPY (one transaction per batch, T-batch)
  for each batch:
    ├─ load N rows from source (ORDER BY id, cursor-based), outside the transaction
    ├─ apply schema patches via SchemaTable, run plugin pipeline
    ├─ advance the checkpoint first: COPYING, token, copiedRows and lastCopiedRowId as read
    └─ insert the batch into the shadow table; a checkpoint that matches nothing writes nothing

PHASE 4: SWAP-BEGIN (T-swap-begin)
  └─ COPYING, token, copiedRows = totalRows → SWAPPING

PHASE 5: SWAP (single serializable transaction)
  ├─ take the branch write fence shared, without the migration-lock check (the record is the swap's own)
  ├─ renew heartbeatAt where SWAPPING and the owner's token, else stop
  ├─ re-check the Draft, the source table, the schema, the shadow row count and, for an imported update, the ledger
  ├─ detach source table from revision, attach shadow table, set revision.hasChanges = true
  ├─ write the schema through the synchronous schema writer: copy-on-write, history entry, `update` ledger row
  ├─ migrate the views row through the synchronous views writer: copy-on-write
  └─ delete the record, guarded by SWAPPING and the owner's token

AFTER COMMIT: notify the endpoints of the Draft (a failure is logged; the swap is not repeated)
```

Every transition is one guarded statement or one transaction: a compare-and-set on the record status and the owner's
claim token. A guard that matches nothing writes nothing, and the owner stops. Each step returns `continue`,
`completed`, `failed`, `cancelled` or `stopped`; the owner runs the next step only after `continue`. A `PENDING`
record resumes at T-init, a `COPYING` record at the next batch from its committed checkpoint, a `SWAPPING` record
directly at the swap. No transition starts from a terminal state (`FAILED`, `CANCELLED`); a new `updateTable` of the
table deletes such a record.

During migration, the entire draft revision is locked for writes (HTTP 423). All reads continue from the source table until swap completes.

## Failure Scenarios

### What happens when migration fails mid-copy?

**State after failure:**

- Schema row: unchanged (still has original schema)
- Source table: still attached to revision, rows unchanged
- Shadow table: partially filled (0 to N batches completed)
- Migration record: status unchanged (`COPYING`), retryCount incremented, lease released (T-retry)

**What readers see:** old schema + old rows. Fully consistent — no visible change until swap succeeds.

**What happens next:** the owner claims the record again at once and resumes the same phase, up to `maxRetries`.
The copy resumes from the committed checkpoint (`copiedRows`, `lastCopiedRowId`); T-init does not run again.

**Permanent failures** skip the retries: a payload that is neither a patch array nor a version 2 envelope fails with
`PAYLOAD_UNSUPPORTED`; a failed swap re-check or an unrecorded imported update fails with its code (see below).
`errorMessage` starts with the code.

### What happens when a migration makes no progress?

The progress of a record is measured from the later of `lastProgressAt` and `lockedAt` (the start of the current
owner's lease), or from `createdAt` when no owner has claimed it and no batch has committed. A sweep cancels every
`PENDING` or `COPYING` record whose progress is older than `stallTimeoutMs` (T-deadline): `status=CANCELLED`,
`errorMessage` starting with `STALLED`, `completedAt`, and the lease cleared. The heartbeat does not matter, so an
owner that keeps its lease alive without committing batches is cancelled too; its next batch matches nothing and it
stops. A record claimed after a long wait gets the whole `stallTimeoutMs` from its claim. `SWAPPING` records are never
cancelled; a stalled swap is taken over instead.

**If all retries fail:** the record stays with `status=FAILED`, the phase it failed in, `completedAt` and
`errorMessage`; the lease is cleared. The revision is **unlocked** (`FAILED` is not an active status), so writes
resume. Schema and rows are consistent (both still original). To retry:

- Call `abortMigration(revisionId, tableId)` to delete the failed record, then retry `updateTable`
- Or call `revertChanges` on the branch to reset the entire draft

### What happens when migration is aborted?

`abortMigration` runs as one serializable transaction. It reads the record and rejects a `SWAPPING` record ("Cannot
abort during swap phase, please wait for completion") and a `CANCELLED` one. Otherwise it deletes the record guarded
by status (`PENDING`, `COPYING` or `FAILED`), and only after that deletion removed the record does it delete the
shadow table and its rows, and only while no revision links the shadow table. A swap that commits between the abort's
read and its deletion makes the abort retry; the retry finds no record and returns as for no migration, so the
abort never deletes the rows the swap has just linked.

**State after abort:**

- Shadow table: deleted (if it exists)
- Migration record: deleted (frees @@unique slot for next migration)
- Source table: still attached, unchanged
- Schema row: unchanged (still has original schema)

After abort, the draft is in a clean state — the next `updateTable` call on the same table will work (migration record was deleted). No revert needed.

Native revert cancels `PENDING` and `COPYING` records inside its own transaction with the same guarded deletion and
rejects a `SWAPPING` record. A revert after a completed swap relinks the Head's table versions, so the recorded
`update` and the migrated rows leave the Draft.

### What does the swap re-check?

Inside its transaction, before writing, the swap checks what may have changed since the start. A failed re-check
commits nothing but T-fail with its code; the Draft stays as the swap found it.

| Code                    | Condition                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `REVISION_NOT_DRAFT`    | The revision is no longer the Draft                                                              |
| `SOURCE_TABLE_REPLACED` | The Draft no longer links the source table version, or already links the shadow table            |
| `SCHEMA_CHANGED`        | The Draft schema row lost `previousSchemaHash`, or the patches no longer give `targetSchemaHash` |
| `ROW_COUNT_MISMATCH`    | The shadow table does not hold `totalRows` rows                                                  |
| `LEDGER_UNAVAILABLE`    | An imported update (`ledgerMigrationId` in the payload) whose Draft has no migration table       |
| `LEDGER_ID_TAKEN`       | The imported id is already in the Draft ledger, or a ledger row is published at or after it      |
| `LEDGER_NOT_RECORDED`   | The migration writer recorded no ledger row for an imported update                               |

An interactive update in a Draft without a migration table completes without a ledger row, as the synchronous
`updateTable` does.

### What happens when the process crashes during swap?

The swap runs in a single serializable transaction:

1. Take the branch write fence shared; behind an exclusive holder it waits at most half of `TRANSACTION_TIMEOUT`, then
   fails with `BranchWriteFencedException`, a transient failure
2. Renew `heartbeatAt` of the record where it is still `SWAPPING` with the owner's token; no match stops the swap
3. Re-check (see above)
4. Detach source table, attach shadow table, set hasChanges
5. Write the schema row, its history entry and the `update` ledger row; migrate the views row
6. Delete the record where it is still `SWAPPING` with the owner's token

The renewal locks the record row until the swap commits, and the change and the deletion of the record commit
together, so a fault or a lost connection after the commit leaves no record to swap again. A claim or a takeover that
arrives meanwhile waits for the row lock and then finds no record, so it does nothing; a claim or a takeover that
committed earlier makes the renewal match nothing, so a replaced owner never commits a swap.

If the process crashes mid-swap, the transaction rolls back. The record stays `SWAPPING`. After its lease expires,
the next claim counts a retry and runs the swap directly, without copying again.

An owner can also keep its lease alive without finishing the swap. Each owner gets a **swap bound** from the start of
its own lease: the larger of `stallTimeoutMs` and `TRANSACTION_TIMEOUT` × `TRANSACTION_MAX_RETRIES`, the longest the
native runner can spend on one swap. A sweep that finds the later of `lastProgressAt` and `lockedAt` older than the
bound takes the owner over (T-takeover), whatever its heartbeat: it writes a new token and `lockedAt`, counts a retry
and runs the swap. The takeover is guarded by the token and `lockedAt` the sweep observed, so several sweeps that saw
the same stalled owner replace it once, and the new owner has a whole bound of its own. The replaced owner's swap
transaction finds another token in its first statement and stops.

Claims after lease expiry and takeovers of a `SWAPPING` record share one budget in `retryCount`. When `retryCount`
has reached `maxRetries`, the claim or takeover fails the record with `SWAP_STALLED` instead, which releases the lock.

### What happens when two workers pick up the same migration?

A worker owns a record after writing a fresh claim token (worker id plus a random suffix) into `lockedBy`. A claim
succeeds only for an active record whose `lockedBy` is empty or whose `heartbeatAt` is older than `lockTimeoutMs`.
The owner renews `heartbeatAt` every `heartbeatIntervalMs` with its token; when the renewal matches nothing, it stops
renewing. A stalled owner that resumes after another worker claimed the record fails every guard: its batch writes
nothing, and it cannot renew, release or fail the new owner's record.

### What happens after maxRetries exhausted?

The migration record stays with:

- `status`: `FAILED`
- `errorMessage`: the last error, or `SWAP_STALLED` when claims and takeovers of `SWAPPING` used up the budget
- `retryCount`: equals `maxRetries`

`FAILED` is not in `ACTIVE_MIGRATION_STATUSES` (only PENDING, COPYING, SWAPPING are). So after final failure:

- The revision is **unlocked** — writes resume
- Schema and rows are both unchanged (consistent)
- The shadow table is orphaned (cleaned by `CleanupService`)
- The failed migration record stays for debugging
- The `@@unique([revisionId, tableId])` constraint blocks a new migration on the same table — call `abortMigration` to delete the failed record

### What happens to records written before the payload envelope?

Records whose `patches` hold a plain patch array were written by engine versions without the payload envelope. They
carry no source migration id, so every process disposes of them at startup, before its sweep runs, each shape by one
guarded statement:

| Legacy record                                                                    | Disposition                            |
| -------------------------------------------------------------------------------- | -------------------------------------- |
| `FAILED`, `CANCELLED`                                                            | Kept; the payload decodes as version 1 |
| `PENDING`, `COPYING`                                                             | `CANCELLED` with `LEGACY_JOB`          |
| `SWAPPING`, the revision no longer exists                                        | Deleted                                |
| `SWAPPING`, the Draft links the shadow table (the old swap committed)            | Deleted                                |
| `SWAPPING`, any other state (source linked, neither linked, no longer the Draft) | `CANCELLED` with `LEGACY_JOB`          |

A cancelled legacy change was not applied by the new engine: rerun `updateTable` or the import.

### Read consistency during migration

| What                           | Before migration | During COPY          | After SWAP                            |
| ------------------------------ | ---------------- | -------------------- | ------------------------------------- |
| Schema (revisium_schema_table) | old              | old                  | **new** (Draft-owned, atomic in swap) |
| Row data                       | old              | old (source table)   | **new** (shadow table)                |
| Row count                      | N                | N (source unchanged) | N (validated)                         |
| Writes                         | allowed          | **blocked** (423)    | allowed                               |

Schema and rows are always consistent from the reader's perspective. The schema row is only updated inside the swap transaction, atomically with the table swap. Before swap: old schema + old rows. After swap: new schema + new rows. No inconsistency window. Revisions other than the Draft keep their schema and views rows.

## Configuration

All options are passed via `EngineModule.forRoot({ migration: { ... } })`:

| Option                | Default    | Description                                                                    |
| --------------------- | ---------- | ------------------------------------------------------------------------------ |
| `threshold`           | 1000       | Row count before async migration activates                                     |
| `batchSize`           | 1000       | Rows processed per batch                                                       |
| `workerMode`          | `'inline'` | `'inline'` (fire-and-forget), `'polling'` (multi-pod), `'disabled'` (external) |
| `pollIntervalMs`      | 5000       | Sweep interval (inline and polling modes)                                      |
| `heartbeatIntervalMs` | 30000      | Lease renewal interval of a running owner                                      |
| `lockTimeoutMs`       | 60000      | A lease whose heartbeat is older than this can be claimed                      |
| `stallTimeoutMs`      | 600000     | Progress deadline of `PENDING` and `COPYING`; the minimum swap bound           |
| `maxRetries`          | 3          | Budget of transient retries and of claims and takeovers of `SWAPPING`          |

## Revision Lock (HTTP 423)

During an active migration, all draft mutation handlers check for an active `TableMigration` record before entering the serializable transaction. If found, they throw `MigrationLockedException` (HTTP 423) with migration progress in the response body:

```json
{
  "statusCode": 423,
  "message": "Revision is locked by an active migration on table \"products\" (COPYING)",
  "migration": {
    "migrationId": "clx...",
    "tableId": "products",
    "status": "COPYING",
    "progress": { "percentage": 45, "copiedRows": 450, "totalRows": 1000 }
  }
}
```

Blocked operations: createRow, updateRow, patchRow, deleteRow, createTable, updateTable, removeTable, renameTable, renameRow, uploadFile, createRows, updateRows, patchRows, removeRows, commit.

Allowed operations: getRows, getTable, getRevision, searchRows, getMigrationStatus, getActiveMigrations, abortMigration, revert (cancels PENDING/COPYING migrations; blocked during SWAPPING).

## Worker Modes

Every process disposes of legacy records when its migration module starts, in every mode, before any sweep runs.

Inline and polling modes run the same **sweep** every `pollIntervalMs`. Each sweep, in order:

1. Cancels the `PENDING` and `COPYING` records past their progress deadline (T-deadline).
2. Takes over every `SWAPPING` owner past its swap bound and drives the record (T-takeover).
3. While the process owns no migration, claims the oldest active record without a live lease and drives it
   (T-claim).

The process counts the leases its drivers hold. Before it claims, the sweep drops every lease whose record is no
longer active or carries another token, so a driver whose record was cancelled or taken over stops counting at once,
even while it is suspended; its later writes still match nothing. The sweep does not wait for the migrations it
drives, so deadlines and takeovers apply while a migration runs. A tick that fires while the previous sweep still runs
is skipped. On shutdown the worker stops sweeping and waits for the migrations it drives.

The sweep and the legacy disposal act on the records the `MigrationRecoveryScope` provider admits: every record in
production. Test kits replace it with an explicit list of migration ids, empty by default, because the test database is
shared.

### Inline (default)

`processMigration()` runs as a detached Promise immediately after the migration record is created. Suitable for single-pod deployments. The caller gets the response immediately with `{ migrationId, migrationStatus: 'migrating' }`.

The recurring sweep recovers what the start-time trigger leaves behind: a migration whose process restarted is claimed once its old lease expires.

### Polling (multi-pod)

Workers sweep the database every `pollIntervalMs`; the claim decides which worker wins a record, and a worker drives one claimed migration at a time.

### Disabled

No worker runs and no sweep runs. The host application must call `processMigration(migrationId)` externally (e.g. from a job queue). The migration record is created with `status=PENDING`. `processMigration` claims the record, renews its lease while it runs and returns the result of its last step; it returns `stopped` when another owner holds a live lease. In this mode no process cancels stalled records or takes over stalled swaps.

## Retry and Recovery

On a transient failure of a step, including the read of the record that starts it, the owner applies T-retry and claims the record again, up to `maxRetries`. T-retry and T-fail are guarded by the owner's token and an active status. Retry is restart-safe:

- T-retry increments `retryCount`, keeps the status and releases the lease; the next claim resumes the same phase
- `copiedRows` and `lastCopiedRowId` are committed with each batch, so copy resumes from the last checkpoint
- Each batch advances its checkpoint by compare-and-set before inserting — no partial or repeated batches
- If the record is deleted (abort), cancelled or changed by another owner, the next guard matches nothing and the worker stops
- The sweep of inline and polling modes claims expired leases, cancels stalled records and takes over stalled swaps

## Database Schema

```prisma
model TableMigration {
  id                   String    @id @default(cuid())
  revisionId           String
  tableId              String
  sourceTableVersionId String
  shadowTableVersionId String?
  status               String    @default("PENDING")
  phase                String    @default("INIT")
  patches              Json
  previousSchema       Json
  previousSchemaHash   String
  targetSchemaHash     String
  totalRows            Int
  copiedRows           Int       @default(0)
  lastCopiedRowId      String?
  batchSize            Int       @default(1000)
  currentBatch         Int       @default(0)
  totalBatches         Int       @default(0)
  createdAt            DateTime  @default(now())
  startedAt            DateTime?
  completedAt          DateTime?
  lastProgressAt       DateTime?
  lockedBy             String?
  lockedAt             DateTime?
  heartbeatAt          DateTime?
  errorMessage         String?
  retryCount           Int       @default(0)
  maxRetries           Int       @default(3)

  @@unique([revisionId, tableId])
  @@index([status])
  @@index([lockedBy])
  @@index([status, heartbeatAt])
}
```

`patches` holds the payload envelope `{ "version": 2, "patches": [...], "ledgerMigrationId"?: "..." }`; the swap
records the `update` ledger row under `ledgerMigrationId` when it is set, and under the native id otherwise. Records
written before the envelope hold a plain patch array, which decodes as version 1; every process disposes of the active
ones at startup (see above). Any other payload fails the migration with `PAYLOAD_UNSUPPORTED`. Old workers misread
the envelope, so stop every process running the old worker code before a new process starts. `lockedBy` holds the
owner's claim token and `lockedAt` the start of its lease. `phase` takes `INIT`, `COPYING` and `SWAPPING` only.

`@@unique([revisionId, tableId])` ensures one migration per table per draft at a time. Records are deleted on completion, abort, and when aborting failed migrations. Call `abortMigration` to clean up a failed record before retrying.

`status` and `phase` are String fields (not Prisma enums) to avoid enum migration issues across deployments.

`previousSchema` and the decoded patches together define the migration. The target schema is never stored explicitly — it is computed on demand as `SchemaTable(previousSchema).applyPatches(patches)`:

- **During copy**: `MigrationBatchService` computes target schema per batch, passes it directly to `PluginService.afterMigrateRows({ targetSchema })` so plugins don't read from DB
- **During swap**: `SwapRecheckService` applies the same patches to `previousSchema` and checks the result against `targetSchemaHash`; the synchronous schema writer (`UpdateSchemaCommand`) writes it with copy-on-write, appends the history entry with the original patches and records the `update` ledger row — all inside the serializable transaction
- **Views parity**: if a `revisium_views_table` row exists for the migrated table, the synchronous views writer (`MigrateTableViewsCommand`) migrates it with copy-on-write inside the same swap transaction

The schema row in `revisium_schema_table` stays unchanged until swap completes.

## Module Structure

```text
src/features/migration/
  migration.module.ts              MigrationModule.forRoot(options?) — global module
  migration-api.service.ts         Facade over CommandBus/QueryBus
  migration.consts.ts              Defaults and DI tokens
  types/migration.types.ts         Status/Phase enums, result interfaces
  exceptions/                      MigrationLockedException (HTTP 423)
  services/
    migration.service.ts           processMigration and takeOverStalledSwap: heartbeat, step runner, retries
    migration-transition.service.ts Guarded transitions of the record (claim, takeover, deadline, renew,
                                   release, init, checkpoint, swap-begin, swap ownership, fail, retry, cancel)
    migration-swap.service.ts      The swap transaction: fence, re-checks, relink, native writers, record deletion,
                                   endpoint notification
    swap-recheck.service.ts        Re-checks of the swap and their permanent failure codes
    migration-batch.service.ts     Row-level: load, patch, plugin, guarded batch write
    migration-worker.service.ts    Legacy disposal at startup; recurring sweep of inline and polling modes
    legacy-migration-disposal.service.ts Terminal disposition of records without the payload envelope
    held-migration-leases.ts       Leases the drivers of this process hold; the claim capacity of the sweep
    migration-recovery-scope.ts    Records the sweep and the legacy disposal may act on (all in production)
    migration-lock.service.ts      Lock check for Api*Handlers; cancellation of a branch's migrations on revert
    lease-heartbeat.ts             Lease renewal timer of one claim
  migration-payload.ts             Payload envelope encoder and decoder
  commands/                        StartAsyncMigration, AbortMigration
  queries/                         GetMigrationStatus, GetActiveMigrations
```

## Known Limitations (v1)

- Threshold is row-count only. Future versions may also consider row data size.
- One active migration per revision at a time.
- Revision-level lock blocks all writes, not just the migrating table. Future versions can narrow to table-level.
- Failed migration records block the @@unique constraint — call `abortMigration` to clean up before retrying.
