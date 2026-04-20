# File Usage Tracking

Engine-level primitive for tracking file-reference bytes per project with content-hash deduplication and a reconcilable validate/restore/backfill API.

The engine treats `projectId` as an **opaque string** — it does not model organizations, project lifecycle, or project metadata. Consumers (for example `@revisium/core`) keep their own project/org records and pass project identifiers to the engine whenever they want file-usage information.

## Motivation & Goals

Revisium's file plugin stores binary content by SHA-256 hash in object storage. Without a tracking layer there is no cheap way to answer "how many bytes does this project currently store?" because file metadata lives scattered inside JSONB row data and row versions share content across revisions (copy-on-write).

This feature adds a tracking layer with these goals:

- **Real-time**: a committed row mutation immediately reflects in the counter.
- **Deduplicated**: same content hash referenced N times in a project counts once.
- **Reconcilable**: an independent truth source lets drift be detected and corrected.
- **Backfill-capable**: projects that predate this feature can be populated from existing row data.
- **Opaque projectId**: engine never tries to own or mirror the consumer's project lifecycle.

Non-goals:

- Organization, project, or soft-delete lifecycle management (consumer's concern).
- S3 deletion itself (`IStorageService` has no delete method). The engine returns the hashes the consumer must delete from its own storage.
- Bandwidth / egress tracking.
- Aggregation over consumer-defined groups (organization, team, etc.) — consumer supplies the set of project IDs.

## Data Model

```
Row (versioned)
  ↕ _FileBlobToRow (M2M join)
  ↕
FileBlob (unique per projectId + hash)

ProjectFileUsage (counter per projectId)
```

### Tables

| Table               | Purpose                                                                      |
| ------------------- | ---------------------------------------------------------------------------- |
| `FileBlob`          | One row per unique `(projectId, hash)` pair; stores `size` and `createdAt`   |
| `_FileBlobToRow`    | Implicit Prisma M2M join between `FileBlob` and `Row`                        |
| `ProjectFileUsage`  | Denormalized per-project counter: `{ projectId, fileBytes, updatedAt }`      |

The consumer's `Organization`, `Project`, and `isDeleted` flag are never mirrored. Engine does not know about them; it only groups bytes by the opaque `projectId` string that consumers pass in.

### FileBlob fields

| Field        | Type           | Purpose                                                                 |
| ------------ | -------------- | ----------------------------------------------------------------------- |
| `id`         | `String` PK    | `nanoid()` identifier                                                   |
| `projectId`  | `String`       | Opaque grouping key; no FK                                              |
| `hash`       | `String`       | SHA-256 of the binary content                                           |
| `size`       | `BigInt`       | Bytes                                                                   |
| `createdAt`  | `DateTime`     | First-reference timestamp                                               |
| `deletedAt`  | `DateTime?`    | Tombstone timestamp; non-null means "pending consumer storage delete"   |

Unique constraint: `(projectId, hash)`. Indexes on `projectId`, `hash`, and `deletedAt`.

### ProjectFileUsage fields

| Field        | Type         | Purpose                                            |
| ------------ | ------------ | -------------------------------------------------- |
| `projectId`  | `String` PK  | Opaque grouping key; no FK                         |
| `fileBytes`  | `BigInt`     | Sum of sizes of distinct `FileBlob` rows for this project |
| `updatedAt`  | `DateTime`   | Prisma `@updatedAt`                                |

Both tables have no foreign keys to any consumer-owned entity. When the consumer deletes a project, it calls `cleanupProjectFileUsage({ projectId })` and the engine tombstones the corresponding `FileBlob` rows (setting `deletedAt`) and drops the `ProjectFileUsage` row. The tombstoned rows survive until the consumer confirms storage deletion via `confirmStorageDeleted`, at which point they are hard-deleted.

### Tombstone lifecycle

A `FileBlob` has three states:

1. **Active** — `deletedAt IS NULL`. Counts toward `ProjectFileUsage.fileBytes`. Has M2M links in `_FileBlobToRow`.
2. **Tombstoned** — `deletedAt IS NOT NULL`. Does **not** count toward the counter. M2M links have been cascade-deleted. Still carries the `(projectId, hash, size)` triple so the consumer can locate and delete the object in its own storage.
3. **Hard-deleted** — row removed entirely via `confirmStorageDeleted({ hashes })` after consumer has deleted the underlying objects.

Re-uploading the same hash while a tombstone exists **reactivates** the existing row (clears `deletedAt` and increments the counter) rather than creating a duplicate. This preserves the original row id and keeps the storage-delete list correct even in upload/delete race scenarios.

## Reference Semantics

Reference-counted deduplication per `(projectId, hash)`. `ProjectFileUsage.fileBytes` only changes on transitions into and out of the "blob has at least one reference" state.

### Write rules

All three operations run in the same transaction as the Row mutation that triggered them.

Draft-row nuance: the engine uses copy-on-write when a readonly row from head is first edited in draft, but once a row already exists as a mutable draft row, later `update*`, `patch*`, and `rename*` calls modify that same row version in place. File-usage tracking therefore must **sync** the row version's file links, not blindly append to history, for those follow-up edits.

**Add a reference** (a row version is inserted that contains a file field with `hash`, `size`):

```text
1. UPSERT FileBlob (projectId, hash, size)
   IF inserted (first time this project has this hash):
     UPSERT ProjectFileUsage: fileBytes += size
2. INSERT _FileBlobToRow (fileBlobId, rowVersionId)
```

**Row version hard-delete** (for example from `cleanOrphanedData`): cascades join rows via Prisma `onDelete: Cascade`; the orphan-sweep pass then **tombstones** `FileBlob` rows with no remaining references and decrements the counter. The tombstoned rows remain until the consumer confirms storage deletion.

**Consumer project delete** (explicit): calls `cleanupProjectFileUsage({ projectId })`. Engine tombstones every active `FileBlob` for that projectId and drops the `ProjectFileUsage` row.

**Consumer confirms storage deletion**: after the consumer has deleted the underlying objects from its own `IStorageService`, it calls `confirmStorageDeleted({ hashes })` to hard-delete the tombstoned rows and free the unique `(projectId, hash)` slot.

### Scenarios

| # | Action                                                         | FileBlob effect                                     | `ProjectFileUsage.fileBytes`  |
| - | -------------------------------------------------------------- | --------------------------------------------------- | ----------------------------- |
| 1 | Upload new file (`hash=H1`, `size=S1`) to row R1               | INSERT `(P, H1, S1)`; INSERT `(F1, R1)`             | `+S1`                         |
| 2 | Re-upload same bytes (same `H1`) — creates new row version R2  | FileBlob unchanged; INSERT `(F1, R2)`               | no change                     |
| 3 | Upload different bytes (`hash=H2`, `size=S2`) — new version R2 | INSERT `(P, H2, S2)`; INSERT `(F2, R2)`; R1 still links F1 | `+S2`                   |
| 4 | Same `H1` uploaded in a different project                      | INSERT `(P2, H1, S1)`; independent FileBlob         | `ProjectFileUsage` for P2 `+S1` |
| 5 | Hard-delete row version + sweep; still has siblings using H1   | Cascade delete one join; refcount > 0               | no change                     |
| 6 | Hard-delete row version + sweep; was last reference to H1      | Cascade delete join; **tombstone** `F1` (`deletedAt`) | `-S1`                       |
| 7 | Update an already-draft row from `H1` to `H2`                 | Same row version is re-synced: disconnect `F1`, connect `F2`, tombstone `F1` if now orphaned | counter becomes `S2` immediately |
| 8 | Update an already-draft row but keep the same `H1`            | Existing M2M link is retained                      | no change                     |
| 9 | Schema migration removes file field from a table               | Mutable draft rows drop stale links immediately; unreachable historical rows are cleaned by later GC | usually immediate, otherwise on GC |
| 10 | Consumer deletes a project                                    | Tombstone all active FileBlobs; drop counter row    | counter row removed           |
| 11 | Re-upload of previously tombstoned hash H1                    | `(P, H1)` is UPSERTed — `deletedAt` cleared, row reactivated | `+S1`                |
| 12 | Consumer calls `confirmStorageDeleted([H1])` after storage delete | Hard-delete tombstoned row                       | no change (already decremented) |

## Plugin Hook Integration

`FileUsageIntegrationService` is invoked by `DraftRevisionApiService`:

- After `createRows` / `updateRows` / `renameRows` succeed, it dispatches `RegisterFileReferencesForRowsCommand` (or the rowVersion-based variant for renames). The handler extracts `hash`, `size`, `fileId` from every `$ref: File` field in the persisted row data, then syncs the row version's M2M links to exactly match the current file set: stale links are disconnected and cleaned up, retained links stay in place, and new or tombstoned blobs are UPSERTed/reactivated as needed.
- Around `removeRows` it captures the blob ids linked to the target rowIds *before* the hard-delete via `findBlobIdsLinkedToRows`, then dispatches `CleanupFileBlobsByIdsCommand` *after*. The scoped cleanup tombstones only those specific blobs whose last `_FileBlobToRow` link just vanished and decrements the counter by the freed bytes. Readonly rows are skipped at the cleanup layer because the M2M links still point back to prior revisions.

System tables (`revisium_schema_table`, `revisium_migration_table`, `revisium_shared_schemas_table`, `revisium_views_table`) are skipped for reference registration.

### Why `revert` is not hooked

`revert` resets the draft revision's `tables` pointer back to head (`revision.tables.set(headTables)`). It does not hard-delete any row versions. The now-unreachable draft-only row versions still hold their `_FileBlobToRow` links, so the related `FileBlob` rows are still considered referenced. The counter only catches up the next time `cleanOrphanedData` runs and hard-deletes those orphan row versions — at which point the cascade + orphan-blob sweep tombstones the blobs.

This means: until the next `cleanOrphanedData` tick, `ProjectFileUsage.fileBytes` is an **upper bound** on truly reachable file bytes after a revert. For billing-critical use cases, run `validateProjectFileBytes` on a short cron and alert on non-zero drift. `cleanOrphanedData` will remove the drift at its own cadence.

## Consumer Integration Lifecycle

The engine tracks file-reference bytes automatically on every row mutation. The consumer only needs to hook into a few events.

### What the engine does automatically

| Trigger                                                           | Engine behavior                                                                                |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `createRow` / `createRows` with uploaded file field               | UPSERT `FileBlob`; INSERT `_FileBlobToRow` link; increment `ProjectFileUsage.fileBytes`        |
| `updateRow` / `updateRows` / `patchRow` / `patchRows`             | If the row is already mutable in the draft, sync its existing row-version links in place; if the row is first cloned from readonly history, register refs on the new row version |
| `renameRow`                                                        | Renames an existing draft row in place when already mutable; otherwise clones from readonly history first |
| `removeRow` / `removeRows`                                        | Pre-query blob ids linked to the rowIds; after the hard-delete, tombstone any of those blobs whose last M2M link just vanished and decrement the counter in real time |
| `uploadFile` (step 2 of the two-step upload)                      | Flows through the row-update path — no extra call needed                                       |
| `applyMigrations` / schema migration that rewrites row data       | Row writes go through the same hook — handled automatically                                    |
| Table / row hard-delete via `cleanOrphanedData`                   | `_FileBlobToRow` cascade-deletes; sweep tombstones orphan `FileBlob` rows and decrements counters |
| Draft `revert`                                                     | No real-time counter hook: draft-only row versions become revision-unreachable but are not hard-deleted until the next `cleanOrphanedData` sweep. Counter catches up there. Use the drift cron to verify |

### What the consumer must do

**1. Delete storage objects and confirm.** Every cleanup operation returns `orphanHashes` — hashes whose last *active* `FileBlob` row was just tombstoned, globally. The tombstone survives until the consumer confirms its own `IStorageService` delete finished. The loop is:

```typescript
const { orphanHashes } = await engine.cleanupOrphanedFileBlobs();

const confirmed: string[] = [];
for (const hash of orphanHashes) {
  try {
    await storage.deleteFile(hash);
    confirmed.push(hash);
  } catch (error) {
    logger.warn(`Storage delete failed for ${hash}`, error);
  }
}

if (confirmed.length > 0) {
  await engine.confirmStorageDeleted({ hashes: confirmed });
}
```

Retry-safe: if the consumer crashes after cleanup but before confirming, the tombstones are still visible via `getPendingStorageDeletions` and can be retried. Calling `confirmStorageDeleted` multiple times with the same hash is idempotent (only tombstoned rows are hard-deleted).

**2. Call `cleanupProjectFileUsage` when a project is hard-deleted.** Because `projectId` is opaque, the engine does not know when a consumer deletes a project. Notify it explicitly:

```typescript
async deleteProject(projectId: string) {
  await consumer.deleteProjectData(projectId);

  const { orphanHashes } = await engine.cleanupProjectFileUsage({ projectId });

  const confirmed: string[] = [];
  for (const hash of orphanHashes) {
    try {
      await storage.deleteFile(hash);
      confirmed.push(hash);
    } catch (error) {
      logger.warn(`Storage delete failed for ${hash}`, error);
    }
  }

  if (confirmed.length > 0) {
    await engine.confirmStorageDeleted({ hashes: confirmed });
  }
}
```

**3. Schedule periodic cleanup + a separate reconcile-storage pass.** Orphan `FileBlob` rows accumulate when row versions are hard-deleted (via `cleanOrphanedData`). A second pass flushes any tombstones that weren't confirmed the first time — typically after transient storage failures.

```typescript
@Cron(CronExpression.EVERY_MINUTE)
async sweep() {
  const { orphanHashes } = await cleanupService.cleanOrphanedData();
  await this.deleteAndConfirm(orphanHashes);
}

@Cron(CronExpression.EVERY_HOUR)
async reconcileStorage() {
  const pending = await engine.getPendingStorageDeletions({ limit: 500 });
  await this.deleteAndConfirm(pending.map((p) => p.hash));
}

private async deleteAndConfirm(hashes: readonly string[]) {
  const confirmed: string[] = [];
  for (const hash of hashes) {
    try {
      await storage.deleteFile(hash);
      confirmed.push(hash);
    } catch (error) {
      logger.warn(`Storage delete failed for ${hash}`, error);
    }
  }
  if (confirmed.length > 0) {
    await engine.confirmStorageDeleted({ hashes: confirmed });
  }
}
```

**4. (Optional) Schedule periodic validation.** Validate is read-only, cheap, and catches counter drift from incidents or manual DB edits:

```typescript
@Cron(CronExpression.EVERY_DAY_AT_3AM)
async validate() {
  for (const projectId of await consumer.listActiveProjectIds()) {
    const report = await engine.validateProjectFileBytes({ projectId });
    if (report.drift !== 0n) {
      alert({ projectId, drift: report.drift });
    }
  }
}
```

When drift is confirmed, run `restoreProjectFileBytes({ projectId })` to atomically align `ProjectFileUsage.fileBytes` with `SUM(FileBlob.size)`.

**5. (One-time) Backfill legacy projects.** Projects that existed before the file-usage tables were added have row data with file metadata but no `FileBlob` rows. Run backfill once per project during the upgrade:

```typescript
// Preview
const preview = await engine.backfillProjectFileBlobs({ projectId, dryRun: true });

// Apply — idempotent
await engine.backfillProjectFileBlobs({ projectId });
```

**6. (Fork) Run backfill after forking a project.** When the consumer forks an existing project (creating a new `projectId` that reuses rows from an existing `revisionId`), the fork inherits row data but has no `FileBlob` rows of its own. Call `backfillProjectFileBlobs({ projectId: newProjectId })` once after the fork completes — this walks the fork's row versions and creates the `FileBlob` rows. Reactivation kicks in automatically if any of the forked hashes happened to be tombstoned.

```typescript
async forkProject(sourceRevisionId: string): Promise<string> {
  const newProjectId = await consumer.fork(sourceRevisionId);
  await engine.backfillProjectFileBlobs({ projectId: newProjectId });
  return newProjectId;
}
```

### End-to-end: project delete with storage cleanup

```typescript
async deleteProject(projectId: string): Promise<void> {
  // 1. Delete consumer-owned records (branches, revisions, rows, etc.)
  await this.consumerProjectRepository.delete(projectId);

  // 2. Tell the engine to tombstone file-usage state for this project
  const { blobsTombstoned, bytesFreed, orphanHashes } =
    await this.engine.cleanupProjectFileUsage({ projectId });

  this.logger.log(
    `Engine tombstoned ${blobsTombstoned} FileBlobs (${bytesFreed} bytes) for project ${projectId}`,
  );

  // 3. Delete storage objects now truly orphan and confirm back to the engine
  const confirmed: string[] = [];
  for (const hash of orphanHashes) {
    try {
      await this.storage.deleteFile(hash);
      confirmed.push(hash);
    } catch (error) {
      this.logger.warn(`Storage delete failed for ${hash}`, error);
      // Left tombstoned — the periodic `reconcileStorage` pass will retry.
    }
  }

  if (confirmed.length > 0) {
    await this.engine.confirmStorageDeleted({ hashes: confirmed });
  }
}
```

### End-to-end: upload → usage → cleanup

```typescript
// 1. Upload — counter increments automatically
await engine.uploadFile({
  revisionId,
  tableId: 'users',
  rowId: 'user-1',
  fileId,
  file,
});

// 2. Read — O(1) counter read
const bytes = await engine.getProjectStorageBytes({ projectId });

// 3. Validate — cheap, read-only
const report = await engine.validateProjectFileBytes({ projectId });
assert(report.drift === 0n);

// 4. Delete a row → cascade runs on next cleanOrphanedData → orphan surfaces there
await engine.removeRow({ revisionId, tableId: 'users', rowId: 'user-1' });
await engine.cleanOrphanedData(); // picks up the orphan, returns orphanHashes
```

## Public API (on `EngineApiService`)

### Read

```typescript
engine.getProjectStorageBytes({ projectId: string }): Promise<bigint>
engine.getStorageBytesForProjects({ projectIds: string[] }): Promise<bigint>
```

`getStorageBytesForProjects` sums `ProjectFileUsage.fileBytes` for the caller-supplied list. Consumer uses this for organization-level or team-level aggregates — the engine does not model those groupings.

### Reconciliation

```typescript
engine.validateProjectFileBytes({ projectId: string }): Promise<{
  projectId: string;
  currentFileBytes: bigint;
  expectedFileBytes: bigint;
  drift: bigint;
  fileBlobCount: number;
  referenceCount: number;
}>
```

Never writes. Safe to call in production.

```typescript
engine.restoreProjectFileBytes({ projectId: string }): Promise<{
  projectId: string;
  previousFileBytes: bigint;
  nextFileBytes: bigint;
  drift: bigint;
}>
```

Atomically sets `ProjectFileUsage.fileBytes = SUM(FileBlob.size)` for the project.

```typescript
engine.backfillProjectFileBlobs({
  projectId: string;
  dryRun?: boolean;
}): Promise<{
  projectId: string;
  scannedRowVersions: number;
  blobsCreated: number;
  referencesCreated: number;
  fileBytesAfter: bigint;
  dryRun: boolean;
}>
```

Scans every row version linked to the project, reconstructs `FileBlob` + `_FileBlobToRow` state, and refreshes the counter. Idempotent.

### Cleanup

```typescript
engine.cleanupOrphanedFileBlobs(): Promise<{
  blobsTombstoned: number;
  bytesFreed: bigint;
  orphanHashes: string[];
}>

engine.cleanupOrphanedFileBlobsForProject({ projectId: string }): Promise<{
  blobsTombstoned: number;
  bytesFreed: bigint;
  orphanHashes: string[];
}>

engine.cleanupProjectFileUsage({ projectId: string }): Promise<{
  projectId: string;
  blobsTombstoned: number;
  bytesFreed: bigint;
  orphanHashes: string[];
}>
```

- `cleanupOrphanedFileBlobs` — called automatically by `cleanOrphanedData`. Sweeps active `FileBlob` rows that have no live `_FileBlobToRow` references, **tombstones** them (`deletedAt = now()`), and decrements the matching counters.
- `cleanupOrphanedFileBlobsForProject` — same sweep scoped to one project.
- `cleanupProjectFileUsage` — unconditionally tombstones every active `FileBlob` for a project and removes the `ProjectFileUsage` row. Intended to be called by the consumer when it hard-deletes a project.

`orphanHashes` is the list of content hashes whose **last active** `FileBlob` row was just tombstoned — i.e. hashes that no project references anymore. The engine does not delete from `IStorageService`; the consumer uses this list to delete the underlying objects from its own storage and then confirms back to the engine.

### Consumer-driven storage deletion

```typescript
engine.getPendingStorageDeletions({
  limit?: number;
  afterHash?: string;
}): Promise<Array<{
  hash: string;
  size: bigint;
}>>

engine.confirmStorageDeleted({ hashes: string[] }): Promise<{
  hashesConfirmed: number;
  blobsDeleted: number;
}>
```

- `getPendingStorageDeletions` returns hashes that are tombstoned with no remaining active row. Use this as the source for a periodic reconcile pass that retries any storage deletions that failed after a cleanup call. The `limit` parameter bounds a single batch, and `afterHash` lets consumers checkpoint large backlogs in stable `hash ASC` order.
- `confirmStorageDeleted` hard-deletes tombstoned rows for the given hashes. Only tombstoned rows are removed — if a hash has been re-uploaded and reactivated in the interim, its row is left alone.

## Error Handling

- Invalid inputs (empty project id, etc.) → `BadRequestException` (400).
- All reads treat unknown `projectId` as zero bytes — they never throw `NotFoundException` because engine does not know which project IDs are valid.

## Performance Characteristics

| Operation                              | Cost                                                       |
| -------------------------------------- | ---------------------------------------------------------- |
| Read `getProjectStorageBytes`          | Single-row read on `ProjectFileUsage`, O(1)                |
| Read `getStorageBytesForProjects`      | `SUM` over matching rows, O(projectIds)                    |
| Add reference                          | 1 UPSERT FileBlob + 1 UPSERT ProjectFileUsage + 1 INSERT M2M |
| Sweep orphans                          | UPDATE `deletedAt` grouped by projectId; one UPSERT per affected project |
| Validate per project                   | `SUM` over active FileBlob rows for the project            |
| Restore                                | Validate + single UPSERT counter                           |
| Backfill                               | Scan all row versions linked to project — O(row-versions)  |
| Cleanup project                        | Bulk tombstone + counter delete, O(active FileBlobs)       |
| Confirm storage deleted                | Bulk delete by hash, O(hashes)                             |

The hot path (reference add) is three trivial SQL statements. The expensive path (backfill) is rare and explicitly scoped per project.

## Concurrency

Mutations run inside the Prisma transaction opened by the CQRS command handler. Two concurrent references to a newly-discovered hash serialize on `UPSERT FileBlob` (unique-constraint lock); only one wins and increments the counter.

A re-upload that targets a tombstoned `(projectId, hash)` row reactivates the row (clears `deletedAt`, increments the counter). This serializes against any concurrent `cleanupOrphanedFileBlobs` pass on the unique index, so either: (a) the sweep happens first — the row is tombstoned, the upload then reactivates it; or (b) the upload happens first — the row moves out of the orphan set before the sweep selects it.

## Test Strategy

Following `testing-architecture.md`:

- **Unit tests** for pure helpers (`FileReferenceExtractorService`). No database.
- **Feature integration tests** using the existing draft test kit (real Prisma). Covers add/read/validate/restore/backfill/cleanup-project-file-usage flows and orphan sweep.
- **E2E tests** via `EngineApiService` through `AppModule.forRoot()`, exercising the full upload → read → reconcile → cleanup flow.

## Limitations (v1)

- **Engine does not call storage delete.** `IStorageService` has no `deleteFile` method inside the engine. The engine tombstones and reports `orphanHashes`; the consumer must delete from its storage and call `confirmStorageDeleted` to finish the cycle.
- **No cross-project deduplication.** Two projects uploading the same content each have their own `FileBlob` row and each count the bytes.
- **Consumer owns project lifecycle.** Engine tracks by `projectId` but doesn't know when projects start or end. The consumer must call `cleanupProjectFileUsage` when a project is hard-deleted on its side; otherwise the `FileBlob` rows linger until the global `cleanupOrphanedFileBlobs` sweep catches them (if the underlying row versions are also gone).
- **Consumer owns fork lifecycle.** Forking a project reuses row data but the engine has no visibility into the fork event. The consumer must call `backfillProjectFileBlobs({ projectId: newProjectId })` after the fork so the new `projectId` gets its own `FileBlob` rows and counter.

## Future Extensions (not in v1)

- Bandwidth / egress tracking.
- Stored group aggregates (opt-in engine-side organization mirror).
