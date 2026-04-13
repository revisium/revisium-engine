# Async Row Migration (Shadow Table Pattern)

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
  ├─ create TableMigration record
  └─ transaction commits (schema row NOT updated yet)

PHASE 2: INIT
  └─ create empty shadow table (not attached to revision)

PHASE 3: COPY (batched)
  for each batch:
    ├─ load N rows from source (ORDER BY id, cursor-based)
    ├─ apply schema patches via SchemaTable
    ├─ run plugin pipeline (targetSchema passed directly, not read from DB)
    ├─ insert batch into shadow ($transaction — atomic per batch)
    ├─ update progress (copiedRows, lastCopiedRowId)
    └─ check cancellation

PHASE 4: VALIDATE
  └─ shadow row count == source row count

PHASE 5: SWAP (single serializable transaction)
  ├─ detach source table from revision
  ├─ attach shadow table to revision
  ├─ update schema row in revisium_schema_table
  └─ set revision.hasChanges = true

PHASE 6: CLEANUP
  └─ delete migration record
```

During migration, the entire draft revision is locked for writes (HTTP 423). All reads continue from the source table until swap completes.

## Failure Scenarios

### What happens when migration fails mid-copy?

**State after failure:**

- Schema row: unchanged (still has original schema)
- Source table: still attached to revision, rows unchanged
- Shadow table: partially filled (0 to N batches completed)
- Migration record: status=PENDING (reset by retry), retryCount incremented

**What readers see:** old schema + old rows. Fully consistent — no visible change until swap succeeds.

**What happens next:** the worker retries automatically (up to `maxRetries`). On retry:

1. `initPhase` detects `shadowTableVersionId` is already set — skips shadow creation
2. `copyPhase` resumes from `lastCopiedRowId` — each completed batch is checkpointed via `$transaction`, so partial batches from the crash don't produce duplicates
3. After all rows are copied, validate + swap proceeds as normal

**If all retries fail:** migration record stays with `status=FAILED` and `errorMessage`. The revision is **unlocked** (`FAILED` is not an active status), so writes resume. Schema and rows are consistent (both still original). To retry:

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

1. Detach source table
2. Attach shadow table
3. Update schema row
4. Set hasChanges

If the process crashes mid-swap, the transaction rolls back — all four operations are atomic. The source table, schema row, and revision stay unchanged. The migration record has `status=SWAPPING`. On restart, the worker retries from the beginning — `initPhase` sees the shadow exists and `copyPhase` sees all rows are already copied (copiedRows == totalRows), so it proceeds directly to validate and swap again.

### What happens when two workers pick up the same migration?

Prevented by `FOR UPDATE SKIP LOCKED` in the polling query. Each worker atomically sets `lockedBy` to its worker ID. If a worker crashes, its heartbeat stops updating. After `lockTimeoutMs` without a heartbeat, another worker can acquire the stale lock.

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
| `heartbeatIntervalMs` | 30000      | Heartbeat refresh interval (polling mode)                                      |
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

On application startup, inline mode scans for existing `PENDING` / `COPYING` / `SWAPPING` migrations and resumes them in created-at order. If the source table no longer exists, the migration is marked `FAILED` instead of being retried forever. This covers process restarts without requiring polling mode.

### Polling (multi-pod)

Workers poll the database for pending migrations every `pollIntervalMs`. Lock acquisition uses `FOR UPDATE SKIP LOCKED` to prevent double-processing. Workers send heartbeats every `heartbeatIntervalMs`. On startup, stale locks (no heartbeat for `lockTimeoutMs`) are released. Stalled migrations (no progress for `stallTimeoutMs`) with no active lock are auto-cancelled.

A `pollingInProgress` guard prevents `setInterval` tick overlap.

### Disabled

No worker runs. The host application must call `processMigration(migrationId)` externally (e.g. from a job queue). The migration record is created with `status=PENDING` and can be picked up by any external system.

## Retry and Recovery

On failure, the migration retries up to `maxRetries` times. Retry is restart-safe:

- If a shadow table already exists (from a previous attempt), `initPhase` reuses it
- `copiedRows` and `lastCopiedRowId` are persisted after each batch, so copy resumes from the last checkpoint
- Each batch insert is wrapped in `$transaction` — no partial batch duplicates
- If the migration record is deleted (abort), `isCancelled()` returns true and the worker stops
- `retryCount` is incremented and status reset to PENDING before each retry
- Inline mode resumes active migrations on process startup; polling mode resumes them via lock recovery and queue polling

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

`@@unique([revisionId, tableId])` ensures one migration per table per draft at a time. Records are deleted on completion, abort, and when aborting failed migrations. Call `abortMigration` to clean up a failed record before retrying.

`status` and `phase` are String fields (not Prisma enums) to avoid enum migration issues across deployments.

`previousSchema` and `patches` together define the migration. The target schema is never stored explicitly — it is computed on demand as `SchemaTable(previousSchema).applyPatches(patches)`:

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
    migration.service.ts           Orchestration: phase flow, retry loop
    migration-batch.service.ts     Row-level: load, patch, plugin, insert
    migration-worker.service.ts    Inline/polling worker, heartbeat, stale locks
    migration-lock.service.ts      Lock check for Api*Handlers
    migration-progress.service.ts  Progress tracking, phase transitions
  commands/                        StartAsyncMigration, AbortMigration
  queries/                         GetMigrationStatus, GetActiveMigrations
```

## Known Limitations (v1)

- Threshold is row-count only. Future versions may also consider row data size.
- One active migration per revision at a time.
- Revision-level lock blocks all writes, not just the migrating table. Future versions can narrow to table-level.
- Failed migration records block the @@unique constraint — call `abortMigration` to clean up before retrying.
