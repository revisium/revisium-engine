# EngineApiService — API Reference

`EngineApiService` is a flat facade over all engine services. Import it from `@revisium/engine`:

```typescript
import { EngineApiService } from '@revisium/engine';
```

All methods delegate to the underlying `*ApiService` classes. Input types are re-exported from the command/query modules.

---

## ChangeSet availability

The published package does not currently export or implement a ChangeSet,
consistency-audit, Commit Plan, or partial-commit API. The current runtime
surface remains the `hasChanges` field, whole-Draft `createRevision` and
`revertChanges` operations, and immutable Revision comparison queries.

The [normative VE-011 target contract](consistency.md) defines exactly eight
future v1 methods. Their names and contracts are documentation targets, not
callable `EngineApiService` methods today.

| Target v1 method | Availability | Contract |
| --- | --- | --- |
| `changeSet` | Target; not implemented | Computed singleton summary |
| `changeSetItems` | Target; not implemented | Bounded semantic-item connection |
| `changeSetItemDetails` | Target; not implemented | Bounded detail connection |
| `discardChangeSet` | Target; not implemented | Atomic item or all-scope Discard |
| `commitChangeSet` | Target; not implemented | Atomic all-scope Commit |
| `auditBranchConsistency` | Target; not implemented | Pure operator-facing audit read |
| `auditBranchConsistencyFindings` | Target; not implemented | Bounded immutable audit-finding connection |
| `changeSetDiagnosticDetails` | Target; not implemented | Bounded immutable diagnostic connection |

The [partial-commit design](design/partial-commit.md) is non-normative,
PDR-008 is not accepted, and no runtime API exists. It defines exactly these
five possible future methods:

| Future method | Availability |
| --- | --- |
| `planChangeSetCommit` | Non-normative future design; not implemented |
| `previewChangeSetCommitItems` | Non-normative future design; not implemented |
| `previewChangeSetCommitIssues` | Non-normative future design; not implemented |
| `previewChangeSetCommitIssueRequired` | Non-normative future design; not implemented |
| `commitPlannedChangeSet` | Non-normative future design; not implemented |

Neither inventory adds TypeScript declarations, package exports, stubs, or a
runtime availability promise.

---

## Tables

### createTable

Create a new table with a JSON Schema.

```typescript
engine.createTable({
  revisionId: string;  // draft revision ID
  tableId: string;     // user-facing table name
  schema: JsonObjectSchema;  // JSON Schema defining columns
})
```

Returns: `{ table, previousVersionTableId }`

### updateTable

Apply JSON Patch operations to a table's schema.

```typescript
engine.updateTable({
  revisionId: string;
  tableId: string;
  patches: JsonPatch[];  // JSON Patch operations (add/remove/replace fields)
})
```

Returns: `{ table, previousVersionTableId, migrationId?, migrationStatus? }`

When the table exceeds the async migration threshold, `migrationId` and `migrationStatus: 'migrating'` are included. Rows are migrated asynchronously via the shadow table pattern.

### renameTable

```typescript
engine.renameTable({
  revisionId: string;
  tableId: string;       // current name
  nextTableId: string;   // new name
})
```

Returns: `{ table, previousVersionTableId }`

### removeTable

```typescript
engine.removeTable({
  revisionId: string;
  tableId: string;
})
```

Returns: `void`

### getTable

```typescript
engine.getTable({
  revisionId: string;
  tableId: string;
})
```

Returns: `{ versionId, createdId, id, readonly, createdAt, updatedAt, system }`

### getTables

Paginated list of tables in a revision.

```typescript
engine.getTables({
  revisionId: string;
  first: number;     // page size
  after?: string;    // cursor
})
```

Returns: `{ edges: [{ cursor, node }], pageInfo, totalCount }`

### getCountRowsInTable

```typescript
engine.getCountRowsInTable({
  tableVersionId: string;  // table's versionId (from getTable result)
})
```

Returns: `number`

### resolveTableSchema

Get the full resolved JSON Schema for a table.

```typescript
engine.resolveTableSchema({
  revisionId: string;
  tableId: string;
})
```

Returns: `JsonObjectSchema`

### resolveTableForeignKeysBy / resolveTableForeignKeysTo

Get tables that reference this table (by) or that this table references (to).

```typescript
engine.resolveTableForeignKeysBy({
  revisionId: string;
  tableId: string;
  first: number;
  after?: string;
})
```

Returns: `{ edges: [{ cursor, node }], pageInfo, totalCount }`

### resolveTableCountForeignKeysBy / resolveTableCountForeignKeysTo

Count of foreign key references.

```typescript
engine.resolveTableCountForeignKeysBy({
  revisionId: string;
  tableId: string;
})
```

Returns: `number`

---

## Rows

### createRow

Create a single row.

```typescript
engine.createRow({
  revisionId: string;
  tableId: string;
  rowId: string;        // user-facing row ID
  data: JsonValue;      // row data matching table schema
})
```

Returns: `{ table, row, previousTableVersionId }`

### createRows

Batch create rows.

```typescript
engine.createRows({
  revisionId: string;
  tableId: string;
  rows: Array<{ rowId: string; data: JsonValue }>;
  isRestore?: boolean;  // skip plugin processing for data restore
})
```

Returns: `{ table, rows, previousTableVersionId }`

### updateRow

Replace all row data.

```typescript
engine.updateRow({
  revisionId: string;
  tableId: string;
  rowId: string;
  data: JsonValue;
})
```

Returns: `{ table, row, previousTableVersionId }`

### updateRows

Batch update rows.

```typescript
engine.updateRows({
  revisionId: string;
  tableId: string;
  rows: Array<{ rowId: string; data: JsonValue }>;
})
```

Returns: `{ table, rows, previousTableVersionId }`

### patchRow

Apply JSON Patch to row data.

```typescript
engine.patchRow({
  revisionId: string;
  tableId: string;
  rowId: string;
  patches: JsonPatch[];
})
```

Returns: `{ table, row, previousTableVersionId }`

### patchRows

Batch patch rows.

```typescript
engine.patchRows({
  revisionId: string;
  tableId: string;
  rows: Array<{ rowId: string; patches: JsonPatch[] }>;
})
```

Returns: `{ table, rows, previousTableVersionId }`

### renameRow

```typescript
engine.renameRow({
  revisionId: string;
  tableId: string;
  rowId: string;
  nextRowId: string;
})
```

Returns: `{ table, row, previousTableVersionId }`

### removeRow

```typescript
engine.removeRow({
  revisionId: string;
  tableId: string;
  rowId: string;
})
```

Returns: `void`

### removeRows

```typescript
engine.removeRows({
  revisionId: string;
  tableId: string;
  rowIds: string[];
})
```

Returns: `void`

### getRow

```typescript
engine.getRow({
  revisionId: string;
  tableId: string;
  rowId: string;
})
```

Returns: `RowWithContext | null` — includes `data`, `hash`, `schemaHash`, `formulaErrors`

### getRowById

```typescript
engine.getRowById({
  rowVersionId: string;
})
```

Returns: `Row | null`

### getRows

Paginated list with filtering and sorting.

```typescript
engine.getRows({
  revisionId: string;
  tableId: string;
  first: number;
  after?: string;
  where?: JsonFilter;   // JSON path-based filtering
  orderBy?: OrderBy[];  // field-based sorting
})
```

Returns: `{ edges: [{ cursor, node: RowWithContext }], pageInfo, totalCount }`

### searchRows

Full-text search across all fields.

```typescript
engine.searchRows({
  revisionId: string;
  query: string;
  first?: number;
  after?: string;
})
```

Returns: `{ edges: [{ cursor, node: SearchRowResult }], pageInfo, totalCount }`

### resolveRowForeignKeysBy / resolveRowForeignKeysTo

Get rows referencing this row (by) or rows this row references (to).

### resolveRowCountForeignKeysBy / resolveRowCountForeignKeysTo

Count of foreign key references for a row.

---

## Revisions

### createRevision

Commit the current draft (creates a new revision).

```typescript
engine.createRevision({
  projectId: string;
  branchName: string;
  comment?: string;
})
```

Returns: `{ id, sequence, createdAt, comment, isHead, isDraft, isStart, hasChanges, previousHeadRevisionId, previousDraftRevisionId }` — the committed revision plus the IDs of the head and draft revisions that existed before the commit

The current implementation gates this operation on stored
`Draft.hasChanges`. `false` returns the established `There are no changes`
error even if another computation would find a semantic delta; `true`
continues the current whole-Draft path. The optional historical `comment` input
has no new ChangeSet message-length limit. The target compatibility rules keep
this exact input and successful Revision projection; see
[Legacy adapters](consistency.md#legacy-adapters).

### revertChanges

Revert all uncommitted changes in the draft.

```typescript
engine.revertChanges({
  projectId: string;
  branchName: string;
})
```

Returns: branch data

The current implementation gates this operation on stored
`Draft.hasChanges`. `false` returns the established `There are no changes`
error, while `true` continues the current whole-Draft revert path. The target
compatibility rules keep this exact input and successful full Branch
projection; see [Legacy adapters](consistency.md#legacy-adapters).

### getRevision

```typescript
engine.getRevision({
  revisionId: string;
})
```

Returns: `{ id, sequence, createdAt, comment, isHead, isDraft, isStart, hasChanges }`

### getMigrations

Get schema migration history for a revision.

```typescript
engine.getMigrations({
  revisionId: string;
})
```

Returns: `Migration[]`

### applyMigrations

Apply schema migrations to draft tables.

```typescript
engine.applyMigrations({
  revisionId: string;
  migrations: Migration[];
})
```

### getRevisionParent / getRevisionChild / getRevisionChildren

Traverse the revision chain.

### getTablesByRevisionId

Get all tables for a specific revision (without pagination).

### resolveChildBranchesByRevision

Find branches that were created from a specific revision.

```typescript
engine.resolveChildBranchesByRevision(revisionId: string)
```

Returns: `Array<{ branch: { id: string }, revision: { id: string } }>`

### resolveBranchByRevision

Find the branch that contains a specific revision.

```typescript
engine.resolveBranchByRevision(revisionId: string)
```

Returns: `Branch`

---

## Revision Changes (Diffs)

These current APIs compare immutable Revision snapshots. They are not
ChangeSet aliases, and the VE-011 target does not change their names, inputs,
pagination, physical projections, ordering, hashes, or response bytes.

### revisionChanges

Get a summary of changes between a revision and its parent.

```typescript
engine.revisionChanges({
  revisionId: string;
  compareWithRevisionId?: string;  // optional: compare with specific revision
})
```

Returns: `{ revisionId, parentRevisionId, totalChanges, tablesSummary, rowsSummary }`

### tableChanges

Get detailed table-level changes with pagination.

```typescript
engine.tableChanges({
  revisionId: string;
  first: number;
  after?: string;
  compareWithRevisionId?: string;
})
```

Returns: `{ edges: [{ cursor, node: TableChange }], pageInfo, totalCount }`

### rowChanges

Get detailed row-level changes with pagination.

```typescript
engine.rowChanges({
  revisionId: string;
  first: number;
  after?: string;
  tableId?: string;
  compareWithRevisionId?: string;
})
```

Returns: `{ edges: [{ cursor, node: RowChange }], pageInfo, totalCount }`

---

## Branches

### createBranch

Create a new branch from a committed revision.

```typescript
engine.createBranch({
  revisionId: string;  // source revision (must be committed, not draft)
  branchName: string;
})
```

Returns: `Branch` (Prisma Branch object with id, name, projectId, etc.)

### deleteBranch

```typescript
engine.deleteBranch({
  branchId: string;
})
```

### getBranch

```typescript
engine.getBranch({
  projectId: string;
  branchName: string;
})
```

Returns: branch with head/draft revision IDs

### getBranchById / getBranches

### getHeadRevision / getDraftRevision / getStartRevision

Get specific revision pointers for a branch.

```typescript
engine.getHeadRevision(branchId: string)
engine.getDraftRevision(branchId: string)
engine.getStartRevision(branchId: string)
```

### getRevisionsByBranchId

Paginated revision history for a branch.

### getTouchedByBranchId

Check if a branch has uncommitted changes.

```typescript
engine.getTouchedByBranchId(branchId: string)
```

Returns: `boolean`

### resolveParentBranch

Find the parent branch and source revision for a child branch.

```typescript
engine.resolveParentBranch({ branchId: string });
```

Returns: `{ branch: { id: string }, revision: { id: string } } | undefined`

### getProjectByBranch

Find which project a branch belongs to.

```typescript
engine.getProjectByBranch(branchId: string)
```

Returns: `{ id: string }`

---

## Files

### uploadFile

Upload a file to a row's file field. Requires `IStorageService` to be provided via `EngineModule.forRoot({ storage })`.

```typescript
engine.uploadFile({
  revisionId: string;
  tableId: string;
  rowId: string;
  fileId: string;
  file: Express.Multer.File;
})
```

`uploadFile` automatically maintains the reference-counted `FileBlob` + `_FileBlobToRow` tables and the per-project `ProjectFileUsage` counter for whichever `projectId` the branch carries.

---

## File Usage

Reference-counted, dedup-aware file byte counters keyed by opaque `projectId`. The engine does not model organizations or project lifecycle — consumers pass project identifiers when they want file-usage information. See [File Usage Tracking](./file-usage.md) for the complete data model and scenarios.

### getProjectStorageBytes

```typescript
engine.getProjectStorageBytes({ projectId: string }): Promise<bigint>
```

O(1) read from `ProjectFileUsage.fileBytes`. Returns `0n` for unknown projectIds.

### getStorageBytesForProjects

```typescript
engine.getStorageBytesForProjects({
  projectIds: string[];
}): Promise<bigint>
```

Sums `ProjectFileUsage.fileBytes` across the supplied list. Use for organization-level or team-level aggregates — the consumer supplies the grouping.

### validateProjectFileBytes

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

### restoreProjectFileBytes

```typescript
engine.restoreProjectFileBytes({ projectId: string }): Promise<{
  projectId: string;
  previousFileBytes: bigint;
  nextFileBytes: bigint;
  drift: bigint;
}>
```

Atomically sets `ProjectFileUsage.fileBytes = SUM(FileBlob.size)` for the project.

### backfillProjectFileBlobs

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

Scans every row version linked to the project, reconstructs `FileBlob` + `_FileBlobToRow` state, and refreshes the counter. Idempotent. Use `dryRun: true` for a preview.

### cleanupOrphanedFileBlobs / cleanupOrphanedFileBlobsForProject

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
```

**Tombstones** active `FileBlob` rows with no live `_FileBlobToRow` references (sets `deletedAt`) and decrements the matching counters. `cleanupOrphanedFileBlobs` is called automatically by `cleanOrphanedData` after row garbage collection.

`orphanHashes` contains content hashes that have **no remaining active `FileBlob` rows anywhere in the database** after the sweep. The tombstoned rows persist until the consumer deletes the underlying storage objects and calls `confirmStorageDeleted`.

### cleanupProjectFileUsage

```typescript
engine.cleanupProjectFileUsage({ projectId: string }): Promise<{
  projectId: string;
  blobsTombstoned: number;
  bytesFreed: bigint;
  orphanHashes: string[];
}>
```

Call when the consumer hard-deletes a project. Unconditionally tombstones every active `FileBlob` for that project and drops the `ProjectFileUsage` counter.

`orphanHashes` contains hashes that had active FileBlobs in the deleted project and have no active FileBlobs remaining in any other project — that is, hashes that are safe to delete from object storage.

### getPendingStorageDeletions

```typescript
engine.getPendingStorageDeletions({
  limit?: number;
  afterHash?: string;
}): Promise<Array<{
  hash: string;
  size: bigint;
}>>
```

Returns tombstoned hashes that still have no active row anywhere. Drives the periodic reconcile-storage cron that retries deletions which failed during the main sweep.

`afterHash` is an optional stable checkpoint cursor for large backlogs. Results are ordered by `hash ASC`, so consumers can page by remembering the last processed hash from the previous batch.

### confirmStorageDeleted

```typescript
engine.confirmStorageDeleted({ hashes: string[] }): Promise<{
  hashesConfirmed: number;
  blobsDeleted: number;
}>
```

Hard-deletes tombstoned rows for the given hashes. Only rows with `deletedAt IS NOT NULL` are removed — if a hash has been re-uploaded and reactivated in the interim, its row is left alone, so the operation is safe to call repeatedly with stale hash lists.

### Storage-side deletion workflow (tombstone + confirm)

The engine never calls `IStorageService.deleteFile`. The cleanup cycle is:

1. Consumer calls a cleanup operation; the engine tombstones rows (sets `deletedAt`) and returns `orphanHashes`.
2. Consumer deletes the underlying storage objects keyed by those hashes.
3. Consumer calls `engine.confirmStorageDeleted({ hashes })` with every hash whose storage delete succeeded; the engine hard-deletes those tombstoned rows.
4. For any storage delete that failed in step 2, the tombstone remains. A periodic `getPendingStorageDeletions` pass retries step 2 and step 3 on the next cron tick.

```typescript
const { orphanHashes } = await engine.cleanupOrphanedFileBlobs();

const confirmed: string[] = [];
for (const hash of orphanHashes) {
  try {
    await storageService.deleteFile(hash);
    confirmed.push(hash);
  } catch {
    // Leave tombstoned — the reconcile pass will retry.
  }
}
if (confirmed.length > 0) {
  await engine.confirmStorageDeleted({ hashes: confirmed });
}
```

The same pattern applies to `cleanupOrphanedFileBlobsForProject` and `cleanupProjectFileUsage`.

### Fork

When a consumer forks a project (same row data, new `projectId`), call `backfillProjectFileBlobs` on the new project so the engine populates `FileBlob` + `_FileBlobToRow` + `ProjectFileUsage` from the forked rows. Reactivation handles any hashes that happen to be tombstoned.

### Re-upload over a tombstone

Uploading a file whose `(projectId, hash)` has been tombstoned reactivates the existing row: `deletedAt` is cleared, M2M links are recreated, and the counter is re-incremented. The consumer does not need to do anything special — the standard row-write path handles it.

---

## Views

### getTableViews

```typescript
engine.getTableViews({
  revisionId: string;
  tableId: string;
})
```

Returns: `TableViewsData` — views with columns, filters, sorts

### updateTableViews

```typescript
engine.updateTableViews({
  revisionId: string;
  tableId: string;
  viewsData: TableViewsData;
})
```

Returns: `boolean`

---

## Sub-Schema

### getSubSchemaItems

Query items that match a sub-schema reference (e.g. all rows with a `$ref: File` field).

```typescript
engine.getSubSchemaItems({
  revisionId: string;
  schemaId: string;   // e.g. SystemSchemaIds.File
  first: number;
  after?: string;
})
```

Returns: `{ edges: [{ cursor, node }], pageInfo, totalCount }`

---

## Cleanup

### cleanOrphanedData

Delete orphaned tables (no revision connections) and rows (no table connections). Call from your own cron.

```typescript
engine.cleanOrphanedData();
```

Returns: `{ tables: number, rows: number }` — counts of deleted entities

---

## Migrations (Async Row Migration)

### getMigrationStatus

Get the status of an active or recent migration for a table.

```typescript
engine.getMigrationStatus({
  revisionId: string;
  tableId: string;
})
```

Returns: `MigrationStatusResult | null`

```typescript
{
  migrationId: string;
  revisionId: string;
  tableId: string;
  status: 'PENDING' |
    'COPYING' |
    'SWAPPING' |
    'COMPLETED' |
    'FAILED' |
    'CANCELLED';
  phase: 'INIT' | 'COPYING' | 'VALIDATING' | 'SWAPPING' | 'CLEANUP' | 'DONE';
  progress: {
    percentage: number;
    copiedRows: number;
    totalRows: number;
  }
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  errorMessage: string | null;
}
```

Returns `null` when no migration exists (including after successful completion, since records are deleted on cleanup).

### getActiveMigrations

Get all active migrations for a revision.

```typescript
engine.getActiveMigrations({
  revisionId: string;
})
```

Returns: `ActiveMigrationResult[]`

### abortMigration

Cancel an in-progress migration. Throws if the migration is in the SWAPPING phase.

```typescript
engine.abortMigration({
  revisionId: string;
  tableId: string;
})
```

Returns: `void`
