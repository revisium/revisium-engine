# Async Row Migration (Shadow Table Pattern)

This document describes the current v1 behaviour; the accepted target design, being implemented, is [async-row-migration-v2](specs/async-row-migration-v2.spec.md).

When `updateTable` is called and the table exceeds the configured row count threshold, rows are migrated asynchronously via a shadow table instead of the synchronous in-transaction path.

This implementation preserves the core ADR-0010 consistency guarantee: readers never observe mixed schema/data state. The schema row is updated only during swap, atomically with switching the draft to the migrated shadow table.

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
  ├─ shadow row count == totalRows
  └─ COPYING, token, copiedRows = totalRows → SWAPPING

PHASE 5: SWAP (single serializable transaction)
  ├─ first statement: renew heartbeatAt where SWAPPING and the owner's token, else stop
  ├─ detach source table from revision, attach shadow table
  ├─ update schema row in revisium_schema_table and the views row
  └─ set revision.hasChanges = true

PHASE 6: CLEANUP
  └─ delete the record, guarded by SWAPPING and the owner's token
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
`PAYLOAD_UNSUPPORTED`. `errorMessage` starts with the code.

**If all retries fail:** the record stays with `status=FAILED`, the phase it failed in, `completedAt` and
`errorMessage`; the lease is cleared. The revision is **unlocked** (`FAILED` is not an active status), so writes
resume. Schema and rows are consistent (both still original). To retry:

- Call `abortMigration(revisionId, tableId)` to delete the failed record, then retry `updateTable`
- Or call `revertChanges` on the branch to reset the entire draft

### What happens when migration is aborted?

**State after abort:**

- Shadow table: deleted (if it exists)
- Migration record: deleted (frees @@unique slot for next migration)
- Source table: still attached, unchanged
- Schema row: unchanged (still has original schema)

After abort, the draft is in a clean state — the next `updateTable` call on the same table will work (migration record was deleted). No revert needed.

### What happens when the process crashes during swap?

The swap runs in a single serializable transaction:

1. Renew `heartbeatAt` of the record where it is still `SWAPPING` with the owner's token; no match stops the swap
2. Detach source table
3. Attach shadow table
4. Update schema row
5. Set hasChanges

The first statement locks the record row until the swap commits. A claim that arrives meanwhile waits for it and then
finds a live lease, and a claim that committed earlier makes the first statement match nothing, so a replaced owner
never commits a swap.

If the process crashes mid-swap, the transaction rolls back. The record stays `SWAPPING`. After its lease expires,
the next claim counts a retry and runs the swap directly, without copying again. When `retryCount` has reached
`maxRetries`, the claim fails the record with `SWAP_STALLED` instead.

The record is deleted in a separate statement after the swap commits. A crash between the two leaves `SWAPPING`, and
the next claim runs the swap again; the atomic swap of [async-row-migration v2](specs/async-row-migration-v2.spec.md)
§3.5 removes this gap.

### What happens when two workers pick up the same migration?

A worker owns a record after writing a fresh claim token (worker id plus a random suffix) into `lockedBy`. A claim
succeeds only for an active record whose `lockedBy` is empty or whose `heartbeatAt` is older than `lockTimeoutMs`.
The owner renews `heartbeatAt` every `heartbeatIntervalMs` with its token; when the renewal matches nothing, it stops
renewing. A stalled owner that resumes after another worker claimed the record fails every guard: its batch writes
nothing, and it cannot renew, release or fail the new owner's record.

### What happens after maxRetries exhausted?

The migration record stays with:

- `status`: `FAILED`
- `errorMessage`: the last error
- `retryCount`: equals `maxRetries`

`FAILED` is not in `ACTIVE_MIGRATION_STATUSES` (only PENDING, COPYING, SWAPPING are). So after final failure:

- The revision is **unlocked** — writes resume
- Schema and rows are both unchanged (consistent)
- The shadow table is orphaned (cleaned by `CleanupService`)
- The failed migration record stays for debugging
- The `@@unique([revisionId, tableId])` constraint blocks a new migration on the same table — call `abortMigration` to delete the failed record

### Read consistency during migration

| What                           | Before migration | During COPY          | After SWAP                           |
| ------------------------------ | ---------------- | -------------------- | ------------------------------------ |
| Schema (revisium_schema_table) | old              | old                  | **new** (updated atomically in swap) |
| Row data                       | old              | old (source table)   | **new** (shadow table)               |
| Row count                      | N                | N (source unchanged) | N (validated)                        |
| Writes                         | allowed          | **blocked** (423)    | allowed                              |

Schema and rows are always consistent from the reader's perspective. The schema row is only updated inside the swap transaction, atomically with the table swap. Before swap: old schema + old rows. After swap: new schema + new rows. No inconsistency window.

## Configuration

All options are passed via `EngineModule.forRoot({ migration: { ... } })`:

| Option                | Default    | Description                                                                    |
| --------------------- | ---------- | ------------------------------------------------------------------------------ |
| `threshold`           | 1000       | Row count before async migration activates                                     |
| `batchSize`           | 1000       | Rows processed per batch                                                       |
| `workerMode`          | `'inline'` | `'inline'` (fire-and-forget), `'polling'` (multi-pod), `'disabled'` (external) |
| `pollIntervalMs`      | 5000       | Polling interval (polling mode only)                                           |
| `heartbeatIntervalMs` | 30000      | Lease renewal interval of a running owner                                      |
| `lockTimeoutMs`       | 60000      | Stale lock threshold                                                           |
| `stallTimeoutMs`      | 600000     | Auto-abort if no progress for 10 min                                           |
| `maxRetries`          | 3          | Retry attempts on failure                                                      |

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

### Inline (default)

`processMigration()` runs as a detached Promise immediately after the migration record is created. Suitable for single-pod deployments. The caller gets the response immediately with `{ migrationId, migrationStatus: 'migrating' }`.

On application startup, inline mode processes the active migrations that no live lease holds, in created-at order. This covers process restarts without requiring polling mode.

### Polling (multi-pod)

Workers poll the database every `pollIntervalMs`, pick the oldest active migration without a live lease and process it; the claim decides which worker wins. Stalled migrations (no progress for `stallTimeoutMs`) with no live lease are auto-cancelled.

A `pollingInProgress` guard prevents `setInterval` tick overlap.

### Disabled

No worker runs. The host application must call `processMigration(migrationId)` externally (e.g. from a job queue). The migration record is created with `status=PENDING`. `processMigration` claims the record, renews its lease while it runs and returns the result of its last step; it returns `stopped` when another owner holds a live lease.

## Retry and Recovery

On a transient failure of a step, including the read of the record that starts it, the owner applies T-retry and claims the record again, up to `maxRetries`. T-retry and T-fail are guarded by the owner's token and an active status. Retry is restart-safe:

- T-retry increments `retryCount`, keeps the status and releases the lease; the next claim resumes the same phase
- `copiedRows` and `lastCopiedRowId` are committed with each batch, so copy resumes from the last checkpoint
- Each batch advances its checkpoint by compare-and-set before inserting — no partial or repeated batches
- If the record is deleted (abort) or changed by another owner, the next guard matches nothing and the worker stops
- Inline mode resumes active migrations on process startup; polling mode claims expired leases while polling

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

`patches` holds the payload envelope `{ "version": 2, "patches": [...] }`. Records written before the envelope hold a
plain patch array, which decodes as version 1; any other payload fails the migration with `PAYLOAD_UNSUPPORTED`. Old
workers misread the envelope, so stop every process running the old worker code before a new process writes a record.
`lockedBy` holds the owner's claim token. `phase` takes `INIT`, `COPYING` and `SWAPPING` only.

`@@unique([revisionId, tableId])` ensures one migration per table per draft at a time. Records are deleted on completion, abort, and when aborting failed migrations. Call `abortMigration` to clean up a failed record before retrying.

`status` and `phase` are String fields (not Prisma enums) to avoid enum migration issues across deployments.

`previousSchema` and the decoded patches together define the migration. The target schema is never stored explicitly — it is computed on demand as `SchemaTable(previousSchema).applyPatches(patches)`:

- **During copy**: `MigrationBatchService` computes target schema per batch, passes it directly to `PluginService.afterMigrateRows({ targetSchema })` so plugins don't read from DB
- **During swap**: `updateSchemaRowInTx` reads the current schema row (still original), applies the same patches, writes the result — all inside the serializable transaction
- **Views parity**: if a `revisium_views_table` row exists for the migrated table, it is migrated inside the same swap transaction using the same patch semantics as the sync `updateTable` path

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
    migration.service.ts           processMigration: claim, heartbeat, step runner, retries
    migration-transition.service.ts Guarded transitions of the record (claim, renew, release, init,
                                   checkpoint, swap-begin, swap ownership, fail, retry)
    migration-batch.service.ts     Row-level: load, patch, plugin, guarded batch write
    migration-worker.service.ts    Inline/polling worker: picks claimable migrations
    migration-lock.service.ts      Lock check for Api*Handlers
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
