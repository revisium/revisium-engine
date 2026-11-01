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
PHASE 1: START (one serializable transaction, admitted as a Draft writer)
  ├─ take the branch write fence shared
  ├─ validate revision is draft
  ├─ one migration per revision: an active record of the revision → MIGRATION_LOCKED
  ├─ validate the schema as the synchronous path does (see "What does the start check?")
  ├─ imported update: require the Draft migration table, check the imported id
  ├─ create TableMigration record (PENDING, payload envelope with the imported id)
  └─ transaction commits (schema row NOT updated yet)

AFTER COMMIT: trigger the inline worker (a failure is logged; the call still returns the migrationId)

CLAIM: the owner writes a fresh claim token into lockedBy

PHASE 2: INIT (one transaction, T-init)
  ├─ PENDING and token → COPYING, startedAt (first time only)
  └─ create and record the shadow table (createdId, createdAt, system of the source)

PHASE 3: COPY (one write transaction per batch, T-batch)
  for each batch:
    ├─ load N rows from source (ORDER BY id, cursor-based), outside the transaction
    ├─ apply schema patches via SchemaTable, run plugin pipeline
    ├─ validate the rows as the synchronous path does (see "What does a batch check and write?")
    └─ one read committed transaction under TRANSACTION_TIMEOUT:
         ├─ advance the checkpoint first: COPYING, token, copiedRows and lastCopiedRowId as read
         ├─ insert the batch into the shadow table; a checkpoint that matches nothing writes nothing
         └─ register the file references of the new row versions against the target schema

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

### What does the start check?

The start runs in one serializable transaction through the native runner and refuses with an exception to the caller,
writing no record:

1. It takes the branch write fence shared, as every Draft writer does; behind an exclusive holder it waits at most
   half of `TRANSACTION_TIMEOUT`, then fails with `BranchWriteFencedException`.
2. The revision must be the Draft (`Revision is not a draft`).
3. One migration per revision: any active record of the revision, on any table, refuses the start with
   `MigrationLockedException` (`MIGRATION_LOCKED`). The check runs inside the transaction, so of two starts on
   different tables that read the lock together one fails serialization and its retry gets `MIGRATION_LOCKED`.
   `updateTable` still checks the lock before it counts rows, outside the transaction.
4. The schema validation of the synchronous `updateTable`, in its order and with its exceptions: at least one patch,
   the JSON Patch schema and every `add`/`replace` value, not a system table, the patches applied to the schema, the
   target schema against the meta-schema, its foreign keys to other tables and its formulas, then dry runs of the
   synchronous schema writer (history patches, field names) and views writer. The draft command
   `ValidateTableUpdateCommand` runs these validators; rows are validated by the batches, not at start.
5. An update imported by `applyMigrations` carries its source id: the Draft must link a migration table, else
   `LEDGER_UNAVAILABLE` (the update could not be recorded under that id), and the imported-id check of the
   synchronous path runs again inside the transaction (`Migration … is already applied`, `Provided id (…) must be
   after last migration date (…)`). The id is written into the payload envelope.

After the commit the start triggers the inline worker. A trigger failure is logged and the call returns the
`migrationId`; the recurring sweep claims the record.

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
`PAYLOAD_UNSUPPORTED`; a migrated row that the synchronous path would refuse fails with `ROW_INVALID`; a failed swap
re-check or an unrecorded imported update fails with its code (see below). `errorMessage` starts with the code.

### What does a batch check and write?

Each batch reads its source rows outside any transaction, applies the patches and runs the plugin pipeline. Then it
validates every migrated row through the synchronous path's data validation (`ValidateDataCommand`): the row against the
target schema and its foreign keys against the revision. The validation runs in its own repeatable read transaction, so
the foreign-key lookups see one snapshot of the revision. A row the synchronous `updateTable` would refuse fails the
migration at once, without retries: `status=FAILED`, `phase=COPYING`, `errorMessage` is `ROW_INVALID: ` followed by the
message of the synchronous exception. The batches committed before it stay in the shadow table, the Draft keeps linking
the source table, and the lock is released.

A valid batch is written in one read committed transaction. It advances the checkpoint first, inserts the new row
versions into the shadow table and registers their file references through the file-usage owner
(`FileUsageIntegrationService`), reading the files through the target schema because the Draft still stores the previous
one. The migrated rows link the blobs their data references. Those blobs already belong to the project through the
source rows, so the registration adds links and leaves the project's file bytes unchanged, and an orphan sweep after the
swap, which deletes the unlinked source rows, tombstones none of them. Both transactions of a batch run under
`TRANSACTION_TIMEOUT`, not Prisma's 5 s default; a batch that outlives it is rolled back and retried as a transient
failure.

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

### What does `applyMigrations` do with a large update?

`applyMigrations` imports migrations under their source ids, for example into a Head-synced replica. An `update` whose
Draft table has at least `threshold` rows runs as an async migration recorded under the source id, and the call waits
for its swap:

1. The imported-id check runs first, as for every migration: an id the Draft ledger already holds is `skipped`, an id
   not after the last published migration is `failed`.
2. An active migration of the revision whose payload carries the id is joined, so a repeated call, for example after the
   caller's own timeout, waits for the same record. Any other active migration of the revision fails the update with the
   `MIGRATION_LOCKED` message.
3. Otherwise the update starts with the id in its payload (see "What does the start check?"); a start error fails it
   before anything is written. Another import of the same ledger can record the update, or start the next one, between
   the id check and the start; when the start meets `MIGRATION_LOCKED` or finds the id already applied, the Draft ledger
   holding the id gives `applied` at once, and otherwise the call looks for an active migration carrying the id again
   and joins it or starts again, at most three times before the error fails the update.
4. The call drives and observes the record. Its observer reads the record at once and then every `pollIntervalMs`, and
   in order: cancels it past its progress deadline (T-deadline); when no driver of the record runs in this process,
   starts one; takes over a `SWAPPING` owner past its swap bound and drives the record. A driver claims the record when
   its lease is empty or expired and runs the steps until one does not continue; a transient failure releases the lease
   and ends the driver, and the next observation claims again, up to `maxRetries`. The observer never waits for a
   driver, so a driver stalled outside a transaction cannot hold the call: the deadline ends the wait, and the resumed
   driver stops at its next guard. This works in every worker mode, `disabled` included.
5. Once the record is no longer active: the Draft ledger holds a row with the id → `applied`; a `FAILED` record →
   `failed` with its `errorMessage`, even when another writer has recorded a later migration meanwhile; otherwise →
   `failed` with `CANCELLED`, followed by the record's `errorMessage` when it has one (for example
   `CANCELLED: STALLED: …`). An abort or a revert during the wait gives `CANCELLED`. The batch stops at the first
   `failed`, so the next migration runs only after the swap released the revision lock.

The call holds no transaction and no branch write fence while it waits, so it can last as long as the migration. A
caller that abandons the call leaves the migration to the sweep of inline and polling modes and to the next call with
the same id, which joins it. Updates below the threshold apply synchronously, as before.

### How is the repair of a schema ledger planned?

The old swap rewrote schema rows in place without recording a migration, so a Head table can have a schema row that its
Head ledger does not reproduce. `MigrationApiService.planSchemaLedgerRepair({ projectId, branchName, tableIds? })` plans
the forward-only repair ([async-row-migration-v2 §6](specs/async-row-migration-v2.spec.md#6-forward-only-repair-repairschemaledger))
and writes nothing; the write step and the engine facade method come later. It reads one `READ ONLY` RepeatableRead
snapshot, fails with `MIGRATION_LOCKED` while an async migration is active in the Draft, and gives each requested Head
table (without `tableIds`, each Head table whose ledger does not reproduce its schema row) the first matching outcome:

| Outcome | When |
| --- | --- |
| `unledgered` | No intact lineage of the Head ledger ends at the table id. |
| `ledgerDoesNotReplay` | The Head ledger replay fails for the table. |
| `notDamaged`, `draftOnlyDamage` | The Head ledger reproduces the Head schema row; the Draft ledger reproduces the Draft schema row, or not. |
| `ledgerInconsistent` | The Draft lacks or alters a published migration, a pending migration cannot be attributed, or the Draft schema history does not extend the Head one. |
| `alreadyRepaired` | The Draft ledger reproduces the Draft schema row and the Draft rows are valid. |
| `rowsNeedMigration` | A baseline reproduces the Draft schema row, but Draft rows fail the synchronous data validation, foreign keys included; `invalidRows` gives their count and up to ten ids. |
| `needsDraftStructureRevert` | Neither baseline reproduces the Draft schema row. |

A table whose pending migrations, replayed from the Head schema rows, reproduce its Draft schema row and whose Draft rows
are valid is a repair candidate. Candidates are not reported yet and `renumbered` is empty: their patch, repair ids and
combined verification (`repaired`, `patchNotReproducible`, `blockedByDependency`) come with the next step. The plan
carries a fingerprint of what it validated: per validated Draft table version its row count and a digest of row version
ids and hashes, and per table version a foreign key consulted a digest of its row ids.

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
| `pollIntervalMs`      | 5000       | Sweep interval (inline, polling); `applyMigrations` observation interval       |
| `heartbeatIntervalMs` | 30000      | Lease renewal interval of a running owner                                      |
| `lockTimeoutMs`       | 60000      | A lease whose heartbeat is older than this can be claimed                      |
| `stallTimeoutMs`      | 600000     | Progress deadline of `PENDING` and `COPYING`; the minimum swap bound           |
| `maxRetries`          | 3          | Budget of transient retries and of claims and takeovers of `SWAPPING`          |

## Revision Lock (HTTP 423)

During an active migration, all draft mutation handlers, the async start among them, check for an active `TableMigration` record inside their serializable transaction, after taking the branch write fence shared. If found, they throw `MigrationLockedException` (HTTP 423) with migration progress in the response body:

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

`MigrationDrivers` admits every driver the process runs, per record: those of the sweep, of the inline trigger and of
`applyMigrations`. It refuses a second driver for a record that already has one in the process, so the sweep, the
inline trigger and an `applyMigrations` observer never drive one record side by side. Only the takeover of a stalled
`SWAPPING` owner runs beside the stalled local driver; T-takeover's guard on the observed token and `lockedAt` keeps it
to one replacement. On shutdown the process admits no new driver and waits for the running ones.

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

`processMigration()` runs as a detached Promise immediately after the migration record is created. Suitable for single-pod deployments. The caller gets the response immediately with `{ migrationId, migrationStatus: 'migrating' }`, also when the trigger fails.

The recurring sweep recovers what the start-time trigger leaves behind: a migration whose process restarted is claimed once its old lease expires.

### Polling (multi-pod)

Workers sweep the database every `pollIntervalMs`; the claim decides which worker wins a record, and a worker drives one claimed migration at a time.

### Disabled

No worker runs and no sweep runs. The host application must call `processMigration(migrationId)` externally (e.g. from a job queue). The migration record is created with `status=PENDING`. `processMigration` claims the record, renews its lease while it runs and returns the result of its last step; it returns `stopped` when another owner holds a live lease. In this mode no sweep cancels stalled records or takes over stalled swaps; only `applyMigrations` does, for the records it waits for (see "What does `applyMigrations` do with a large update?").

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

- **During copy**: `MigrationBatchService` computes target schema per batch and passes it directly to `PluginService.afterMigrateRows({ targetSchema })`, the row validation (`ValidateDataCommand`) and the file registration (`registerReferencesForRows({ tableSchema })`), so none of them reads the schema the Draft still stores
- **During swap**: `SwapRecheckService` applies the same patches to `previousSchema` and checks the result against `targetSchemaHash`; the synchronous schema writer (`UpdateSchemaCommand`) writes it with copy-on-write, appends the history entry with the original patches and records the `update` ledger row — all inside the serializable transaction
- **Views parity**: if a `revisium_views_table` row exists for the migrated table, the synchronous views writer (`MigrateTableViewsCommand`) migrates it with copy-on-write inside the same swap transaction
- **At start**: `ValidateTableUpdateCommand` applies the patches to the Draft schema and runs the synchronous validators and dry runs (`dryRun: true`) of `UpdateSchemaCommand` and `MigrateTableViewsCommand`, the writers the swap runs later

The schema row in `revisium_schema_table` stays unchanged until swap completes.

## Module Structure

```text
src/features/migration/
  migration.module.ts              MigrationModule.forRoot(options?) — global module
  migration-api.service.ts         Facade over CommandBus/QueryBus
  migration.consts.ts              Defaults and DI tokens
  types/migration.types.ts         Status/Phase enums, result interfaces
  exceptions/                      MigrationLockedException (HTTP 423), LedgerUnavailableException
  services/
    migration.service.ts           processMigration and takeOverStalledSwap: heartbeat, step runner, retries;
                                   processUntilReleased: one claim, ended by a transient failure
    migration-import.service.ts    applyMigrations support: the active import of a source id; drive and observe a
                                   record until it is no longer active
    migration-drivers.ts           Admission of the drivers the process runs: one per record, takeovers beside it
    migration-transition.service.ts Guarded transitions of the record (claim, takeover, deadline, renew,
                                   release, init, checkpoint, swap-begin, swap ownership, fail, retry, cancel)
    migration-swap.service.ts      The swap transaction: fence, re-checks, relink, native writers, record deletion,
                                   endpoint notification
    swap-recheck.service.ts        Re-checks of the swap and their permanent failure codes
    migration-batch.service.ts     Row-level: load, patch, plugin, row validation, guarded batch write with file
                                   references
    migration-worker.service.ts    Legacy disposal at startup; recurring sweep of inline and polling modes
    legacy-migration-disposal.service.ts Terminal disposition of records without the payload envelope
    held-migration-leases.ts       Leases the drivers of this process hold; the claim capacity of the sweep
    migration-recovery-scope.ts    Records the sweep and the legacy disposal may act on (all in production)
    migration-lock.service.ts      Lock check for Api*Handlers; cancellation of a branch's migrations on revert
    lease-heartbeat.ts             Lease renewal timer of one claim
  ledger-repair/                   Repair planning: snapshot reader, ledger baselines and outcomes, Draft row
                                   validation and fingerprint
  migration-payload.ts             Payload envelope encoder and decoder
  commands/                        StartAsyncMigration (admission, validation, record, trigger), AbortMigration
  queries/                         GetMigrationStatus, GetActiveMigrations, PlanSchemaLedgerRepair
```

## Known Limitations (v1)

- Threshold is row-count only. Future versions may also consider row data size.
- One active migration per revision at a time.
- Revision-level lock blocks all writes, not just the migrating table. Future versions can narrow to table-level.
- Failed migration records block the @@unique constraint — call `abortMigration` to clean up before retrying.
