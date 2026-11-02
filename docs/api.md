# EngineApiService — API Reference

`EngineApiService` is a flat facade over all engine services; the partial commit and revert operations are grouped in
the [`changes` namespace](#partial-changes). Import it from `@revisium/engine`:

```typescript
import { EngineApiService } from '@revisium/engine';
```

All methods delegate to the underlying `*ApiService` classes. Input types are re-exported from the command/query modules.

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

### getPreviousRowStates

Returns the previous distinct persisted states of one Row identity at an exact
committed Revision. The selected/current state is omitted; `edges[0]` is the
newest previous state.

```typescript
engine.getPreviousRowStates({
  revisionId: string; // exact committed snapshot
  tableId: string;    // user-facing id in that snapshot
  rowId: string;      // user-facing id in that Table snapshot
  first: number;      // integer, 1..100
  after?: string;     // opaque, versioned, scope-bound cursor
})
```

Returns:

```typescript
{
  edges: Array<{
    cursor: string;
    node: {
      row: Row;
      table: Table;
      revision: Revision;
      branch: Branch;
      introducedBy: Array<'created' | 'modified' | 'renamed'>;
    };
  }>;
  pageInfo: PageInfo;
  totalCount: number;
} | null
```

`node.revision` and `node.branch` are the actual ancestor context where that
state first became effective, including a parent Revision from another Branch
in the same Project. `introducedBy` describes direct-parent -> returned node;
a rename and data modification may both be present.

State equality is `Row.id` plus persisted `Row.data`. Physical copy-on-write,
Table rename/schema changes, and changes to Row metadata, timestamps,
`schemaHash`, or `versionId` do not create states. Rows are hydrated directly
from persistence; formula/plugin computation is not performed.

Without a cursor, returns `null` when the exact Revision/Table/Row snapshot
cannot be resolved. A resolved Row with no previous state returns an empty
non-null connection. Supplying a cursor makes an unresolved or changed selector
a cursor-scope error. Draft tips or ancestors, invalid page sizes/cursors,
duplicate logical states, broken or cyclic ancestry, and cross-Project parent
chains are errors.

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

To commit or revert only selected Draft changes, use
[`changes.commit` and `changes.revert`](#partial-changes).

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
continues the current whole-Draft path.

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
error, while `true` continues the current whole-Draft revert path.

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

These current APIs compare immutable Revision snapshots.

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

## Partial Changes

`engine.changes` groups four operations on the changes of a branch's Draft: `list` pages them as units, `preview`
plans a commit or revert of a selection, and `commit` and `revert` apply it. The native `createRevision` and
`revertChanges` keep their signatures and still apply the whole Draft. The unit model, the selection rules, required
reasons and blockers are specified in [partial-changes-v1](specs/partial-changes-v1.spec.md#5-operations); the input
and result types are exported from `@revisium/engine`.

Every operation takes `branch: { projectId: string; branchName: string }` (`ChangesBranch`) and reads the Head and
Draft of that branch. A unit is the smallest change an operation applies: a field, a row creation, deletion,
replacement or rename, the row columns, a table structure, a views document or a shared schema. A `Selection` names
units by public ids:

```typescript
type Selection = SelectionItems & { all?: boolean; exclude?: SelectionItems };
type SelectionItems = {
  tables?: Array<string | { tableId: string; side?: 'head' }>; // structure units
  tableData?: string[]; // row and field units of a table
  views?: string[];
  sharedSchemas?: string[];
  rows?: RowRef[]; // every unit of a row
  renames?: RowRef[]; // the rowRename unit only
  rowColumns?: RowRef[]; // the rowColumns unit only
  fields?: Array<{ tableId: string; rowId: string; path: string }>; // path is a JSON Pointer
};
type RowRef = { tableId: string; rowId: string; side?: 'head' };
```

`side: 'head'` addresses a Head-side unit whose id a rename took over.

### changes.list

Pages the selectable units with exact selectors. Read-only.

```typescript
engine.changes.list({
  branch: ChangesBranch;
  tableId?: string;   // only units of this table: Draft id, else Head id
  cursor?: string;    // nextCursor of the previous page
  pageSize?: number;  // 1–5,000, default 500
})
```

Returns: `{ headRevisionId, draftRevisionId, units: ListedUnit[], nextCursor: string | null, refusedTables }`

- Each unit carries a `selector` that selects exactly that unit; the caller adds it to a selection or to `exclude`.
- A page can hold fewer than `pageSize` units, or none. Only `nextCursor: null` ends the listing.
- Each page reads its own snapshot and returns its Head and Draft ids, so concurrent edits can move units between
  pages. What a commit or revert applies is bound by `expected`, not by the listing.
- `refusedTables` lists every table whose units partial operations refuse: `headSchemaInconsistent` (the Head schema
  does not match the schema replayed from the Head ledger) or `unledgeredTable` (the table has no intact ledger
  lineage). Such tables are committed or reverted natively or with exactly `{ all: true }`.

### changes.preview

Plans a commit or revert of a selection and writes nothing.

```typescript
engine.changes.preview({
  branch: ChangesBranch;
  operation: 'commit' | 'revert';
  selection: Selection;
  includeRequired?: boolean;  // treat required additions as accepted; affects only status
})
```

Returns: `PreviewChangesResult`

```typescript
{
  status: 'ready' | 'required' | 'blocked' | 'empty';
  headRevisionId: string;
  draftRevisionId: string;
  fingerprint: string;          // pass as expected; '' when a limit refused the plan
  counts: { selected: number; required: number; remaining: number };
  unreadTables: number;         // tables not read; their row units are not in counts.remaining
  refusedTables: RefusedTable[];
  required: RequiredUnit[];     // required additions, each with its reason
  blockers: Blocker[];
  deferred: Deferred[];         // commit only: rows committed without their table's structure
  sample: UnitRef[];            // up to 20 applied units, for display
  unmatched: SelectionItems & { exclude?: SelectionItems };
  estimate: Estimate;
}
```

### changes.commit

Commits the selected units: the Draft revision becomes the new Head with only the selected changes, and a new Draft
keeps the rest.

```typescript
engine.changes.commit({
  branch: ChangesBranch;
  selection: Selection;
  includeRequired?: boolean;  // apply the required additions; requires expected
  expected?: string;          // fingerprint of a commit preview of the same selection
  comment?: string;           // stored on the new Head revision; default ''
})
```

Returns: `CommitChangesResult`. With `status: 'applied'`:
`{ previousHeadRevisionId, headRevisionId, draftRevisionId, applied: { selected, required }, remaining: { units, unreadTables }, renumbered }`.
`headRevisionId` is the former Draft revision; `renumbered` lists the `{ from, to }` ids of the pending migrations
that the commit renumbered.

### changes.revert

Reverts the selected units in the Draft. The input is that of `changes.commit` without `comment`; `expected` is the
fingerprint of a revert preview.

Returns: `RevertChangesResult`. With `status: 'applied'`:
`{ headRevisionId, draftRevisionId, applied: { selected, required }, remaining: { units, unreadTables } }`, with the
unchanged Head and the same Draft revision.

### Statuses

The operations decide the status in this order; preview skips the `stale` check and returns `ready` where commit and
revert apply the plan.

| Status | Condition | Commit and revert result fields |
| --- | --- | --- |
| `blocked` | A limit refused the plan (`tooLarge`), whatever `expected` is. | `blockers`, `required`, `unmatched` (when present) |
| `empty` | No unit to apply and no blocker, including a repeat of an applied commit or revert. | `headRevisionId`, `draftRevisionId`, `unmatched` (when present) |
| `stale` | `expected` is given and differs from the current fingerprint. | none |
| `blocked` | A blocker, or a selector that matches no unit (`unmatchedSelector`). | `blockers`, `required`, `unmatched` (when present) |
| `required` | Required additions exist and `includeRequired` is not set. | `required` |
| `applied` (`ready` in preview) | Otherwise. | See `changes.commit` and `changes.revert`. |

Only `applied` writes. The codes of required reasons (`RequiredReasonCode`) and blockers (`BlockerCode`) are listed
in [SPEC §5.7](specs/partial-changes-v1.spec.md#57-required-reasons) and
[§5.8](specs/partial-changes-v1.spec.md#58-blockers).

### The `expected` rule for hosts

A commit or revert with `expected` applies exactly the previewed plan: when the Head or Draft changed since the
preview, it returns `stale` and writes nothing. Without `expected`, it plans again on the current state.

The engine keeps `expected` optional for internal callers. A host that exposes `changes.commit` or `changes.revert`
through a public API or MCP rejects a call without `expected` unless its selection is exactly `{ all: true }`. The
host also enforces permissions and writes audit records, which the engine does not do
([SPEC §5.10](specs/partial-changes-v1.spec.md#510-facade-and-transports)). A host that notifies endpoints after
native writes notifies them after an applied commit for the former Draft revision and the new Draft, and after an
applied revert for the Draft.

### Errors

| Condition | Error |
| --- | --- |
| `includeRequired: true` without `expected`; a malformed selection: an unknown field, a wrong type, an empty id, a `path` that is not a JSON Pointer, `side` other than `'head'`, `all` or `exclude` inside `exclude` | `BadRequestException` before any transaction |
| `changes.list` with an invalid `pageSize` or `cursor`, or a `tableId` that names no Head or Draft table | `BadRequestException` |
| Unknown project or branch | The native not-found error |
| Commit or revert while an async migration is active on the branch | `MigrationLockedException` (`MIGRATION_LOCKED`); preview returns the `migrationInProgress` blocker instead |
| The operation outlives `PARTIAL_CHANGES_OPERATION_TIMEOUT_MS` | `OperationTimeoutException` (`OPERATION_TIMEOUT`) |
| Every attempt of a commit or revert fails serialization (`PARTIAL_CHANGES_MAX_ATTEMPTS`) | The last serialization failure |

A failed operation persists nothing, file references and ledger rows included, so a retry is safe. The limits and
settings are listed in [ENV.md](../ENV.md#partial-changes).

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
