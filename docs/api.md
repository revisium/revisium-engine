# EngineApiService — API Reference

`EngineApiService` is a flat facade over all engine services. Import it from `@revisium/engine`:

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

Returns: `{ table, previousTableVersionId }`

### updateTable

Apply JSON Patch operations to a table's schema.

```typescript
engine.updateTable({
  revisionId: string;
  tableId: string;
  patches: JsonPatch[];  // JSON Patch operations (add/remove/replace fields)
})
```

Returns: `{ table, previousTableVersionId }`

### renameTable

```typescript
engine.renameTable({
  revisionId: string;
  tableId: string;       // current name
  nextTableId: string;   // new name
})
```

Returns: `{ table, previousTableVersionId }`

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

### revertChanges

Revert all uncommitted changes in the draft.

```typescript
engine.revertChanges({
  projectId: string;
  branchName: string;
})
```

Returns: branch data

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

---

## Revision Changes (Diffs)

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

---

## Files

### uploadFile

Upload a file to a row's file field.

```typescript
engine.uploadFile({
  revisionId: string;
  tableId: string;
  rowId: string;
  fileId: string;
  file: Express.Multer.File;
})
```

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
