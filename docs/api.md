# EngineApiService — API Reference

`EngineApiService` is a facade over all engine services; its methods are flat, except the Draft changes operations,
which are grouped in the `changes` namespace. Import it from `@revisium/engine`:

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

`createRevision` and `revertChanges` commit or revert the whole Draft. To commit or revert only some of its changes,
use [Draft Changes](#draft-changes).

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

These current APIs compare immutable Revision snapshots. To show a branch's Draft against its Head with how each
change is selected, use the Draft reads of [Draft Changes](#draft-changes).

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

The engine orders table changes by the table's id in `revisionId` (for a removed table, its id in the compared revision), then by `createdId`, so while the compared revisions do not change, pages neither skip nor repeat a table.

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

## Draft Changes

`engine.changes` reads a branch's Draft against its Head and commits or reverts a selection of the Draft's changes.
The whole-Draft `createRevision` and `revertChanges` are unchanged. Every method takes `branch: { projectId,
branchName }` (`ChangesBranch`) and acts on that branch's Head and Draft. This section is a guide; the contract is in
[partial-changes-v1](specs/partial-changes-v1.spec.md) (units, selection, plans, results, fingerprint, limits) and
[draft-reads-v1](specs/draft-reads-v1.spec.md) (the three reads). Every type named here is exported from
`@revisium/engine` under that name, and so is every object type that a result holds, also where this guide writes it
inline: a table item's `TableData`, a page's `DraftEdge`, the summary's `DraftTablesSummary`, the estimate's
`MixedTableEstimate`, the row selection `SelectableRowSelection`, and the two `blocked` results
`PlannedChangesBlocked` and `StoppedChangesBlocked`. Only the variants of a discriminated union (`Unit` and
`ReasonSite` by `kind`, `ReferencedEntity` by `kind`) and the parts of an intersection have no names of their own.

| Method | Does | Writes |
| --- | --- | --- |
| `changes.summary` | Totals of the Draft's changes, and the changes that no table item shows | no |
| `changes.tableChanges` | Pages the changed tables, each with how its changes are selected | no |
| `changes.rowChanges` | Pages the changed rows with their field and column changes, each with how it is selected | no |
| `changes.list` | Pages every selectable unit with an exact selector | no |
| `changes.preview` | Plans a commit or a revert of a selection | no |
| `changes.commit` | Publishes the selected changes into Head | yes |
| `changes.revert` | Takes the selected changes out of the Draft | yes |

A typical client:

1. shows the Draft with `summary`, `tableChanges` and `rowChanges`; every item carries the selectors of its changes;
2. builds a `Selection` from the selectors the user picked;
3. previews the commit or revert and shows `required`, `blockers`, `deferred` and `coverage`;
4. applies it with `expected: preview.fingerprint`, and with `includeRequired: true` when the user accepts the
   additions listed in `required` (or adds their selectors to the selection and previews again);
5. on `blocked`, shows the `blockers` and lets the user change the selection; on `stale`, drops the `unmatched`
   selectors and previews again.

```typescript
const branch = { projectId: 'proj-1', branchName: 'master' };
const selection = { fields: [{ tableId: 'products', rowId: 'lamp', path: '/title' }] };

const preview = await engine.changes.preview({ branch, operation: 'commit', selection });

if (preview.status === 'ready' || preview.status === 'required') {
  const result = await engine.changes.commit({
    branch,
    selection,
    includeRequired: true, // apply the additions the preview listed in `required`
    expected: preview.fingerprint,
    comment: 'Rename the lamp',
  });
  // result.status: 'applied' | 'blocked' | 'stale' | 'empty' ('required' only without includeRequired)
}
```

### Units and selections

A **unit** is the smallest change that is applied on its own ([SPEC §3](specs/partial-changes-v1.spec.md#3-unit-model)):

| `kind` | The change |
| --- | --- |
| `field` | One value of a row on both sides (an array or a File is one value). |
| `rowCreate`, `rowDelete`, `rowReplace` | A created row, a deleted row, or a row id deleted and created again. |
| `rowRename` | A row's id; the row's edits are separate units. |
| `rowColumns` | The row columns `publishedAt`, `meta` and `schemaHash` that no field or structure unit owns. |
| `structure` | A table's existence, id, schema, schema history and pending migrations, the values of its changed fields in every row, and its views. |
| `views` | The views of a table whose structure did not change. |
| `sharedSchema` | One shared schema. |

A `Selection` is a union of selectors minus `exclude`; every field is optional:

| Field | Selects |
| --- | --- |
| `all: true` | Every unit of the Draft. |
| `structures: [{ tableId, side? }]` | The structure unit of each table. |
| `tableData: [tableId]` | Every row and field unit of each table that exists on both sides. |
| `views: [tableId]` | The views unit of each table. |
| `sharedSchemas: [sharedSchemaId]` | Each shared schema unit. |
| `rows: [{ tableId, rowId, side? }]` | Every unit of each row. |
| `rowRenames: [{ tableId, rowId, side? }]` | Only the rename of each row. |
| `rowColumns: [{ tableId, rowId, side? }]` | Only the `rowColumns` unit of each row. |
| `fields: [{ tableId, rowId, path }]` | The field units at or below each JSON Pointer. |
| `exclude` | The same item fields; their units are left out. |

Ids are public ids: the Draft id, else the Head id. `side: 'head'` addresses a deleted row or removed table whose id a
rename took over. Paths are JSON Pointers (`/dims/width`), never the native dot paths of the patch APIs. Clients need
not build selectors from item fields: every read returns them ready (`selector` of a unit, `tableData.selector`
of a table item, `row` of a row selection), and a returned selector (`SelectionItems`) can be added to a selection or
to its `exclude` as it is. A selection is closed over its dependencies: a value of a row created in the Draft needs
the row's creation, a reference needs the row it references, and so on; such units come back as required additions
with a reason ([SPEC §5.7](specs/partial-changes-v1.spec.md#57-required-reasons)).

### Input rules

- An optional input given as `null` is treated as absent, at any depth, so a transport that sends `null` for an
  omitted argument (as GraphQL clients do) needs no mapping. A required field given as `null` is refused.
- An unknown field of a selection is refused, including the pre-v2.0 fields `tables` and `renames`.
- `expected` is optional in the engine. A host's public API and MCP must require it for `commit` and `revert` unless
  the selection is exactly `{ all: true }`, so that users apply only what they reviewed. `includeRequired: true`
  requires `expected` in the engine too.
- `isWholeDraftSelection(selection: SelectionInput): boolean` tells a host whether the operations take a selection as
  exactly `{ all: true }`, so the host enforces the rule above without a copy of it. It validates the selection as the
  operations do and applies the planner's own rule; a malformed selection throws the operations'
  `BadRequestException` (400). An optional field given as `null` is absent; any other field makes the selection
  partial, even an empty list or an empty `exclude`:

  | Selection | Whole Draft |
  | --- | --- |
  | `{ all: true }` | yes |
  | `{ all: true, rows: null }`, `{ all: true, exclude: null }` | yes |
  | `{ all: true, rows: [] }` | no |
  | `{ all: true, exclude: {} }` | no |
  | `{ all: true, exclude: { rows: [] } }`, `{ all: true, exclude: { rows: null } }` | no |
  | `{ all: false }`, `{ all: null }`, `{}` | no |

### changes.list

```typescript
engine.changes.list({
  branch: ChangesBranch;
  tableId?: string | null; // only units of this table (Draft id, else Head id)
  cursor?: string | null;  // nextCursor of the previous page
  pageSize?: number | null; // 1–5,000, default 500
}): Promise<{
  headRevisionId: string;
  draftRevisionId: string;
  units: ListedUnit[];   // in listing order, each with its `selector`
  nextCursor: string | null; // null only at the end
  refusedTables: RefusedTable[];
}>
```

A page can hold fewer units than `pageSize`, or none; only `nextCursor: null` ends the listing. The listing has no
total. Each page reads its own snapshot, so units can move between pages under concurrent edits; what a commit applies
is bound by `expected`, not by the listing. A structure unit carries `structureChange` (what the table's structure
change consists of, field by field), and another unit of a table with a structure unit names it in `structure`.

Pass as `cursor` only the `nextCursor` of an earlier listing page. The cursors of the Draft reads have another format,
and the listing does not yet refuse them all: a known defect lets a row or table cursor of the Draft reads through, and
the listing then pages from a wrong position. The `tableId` filter resolves the id to one table, the Draft table
first, so a removed table whose id a rename took over (its structure unit has `side: 'head'`) is not listed under that
id; only the unfiltered listing shows its unit.

### changes.preview

```typescript
engine.changes.preview({
  branch: ChangesBranch;
  operation: 'commit' | 'revert';
  selection: SelectionInput; // a Selection; null in an optional field is absent
  includeRequired?: boolean | null; // treat the required additions as accepted (affects `status` only)
}): Promise<PreviewChangesResult>
```

Writes nothing. The result (`PlannedPreview | StoppedPreview`, discriminated by `planned`):

| Field | Meaning |
| --- | --- |
| `status` | `ready`, `required`, `blocked` or `empty` (see [Statuses](#statuses)). |
| `planned` | `false` only when a limit stopped the plan; then `status` is `blocked` with a `tooLarge` blocker. |
| `headRevisionId`, `draftRevisionId` | The revisions the plan was made on. |
| `fingerprint` | Pass it as `expected` to `commit` or `revert`; `null` when not `planned`. |
| `counts` | `{ selected, required }`: selected units and required additions; `null` when not `planned`. |
| `coverage` | Per user table with an applied unit: `rows`, `appliedRows`, `partlyAppliedRows`, and whether its `structure` and `views` are applied. |
| `required` | Each required addition: `unit` (with its `selector`) and `reason` (`code`, `site`, `references`, `cause`, `because`). |
| `blockers` | What prevents the operation, each with a `code` and a `message`; `migrationInProgress` while an async migration runs on the branch. |
| `deferred` | Commit only: created or replaced rows committed without their table's structure, with the values the commit writes (`defaulted`) and the paths it leaves out (`omitted`). |
| `sample` | The first 20 applied units in listing order, for display (`changes.list` is the complete list). |
| `unmatched` | The selectors that matched no unit; `{}` when every selector matched, `null` when not `planned`. |
| `refusedTables` | Tables that partial operations refuse on this branch (see [Refused tables](#refused-tables)); empty for exactly `{ all: true }`. |
| `estimate` | What the plan measured against the limits. |

A plan stopped by a limit returns no value of the plan: `fingerprint`, `counts` and `unmatched` are `null`, and
`coverage`, `required`, `deferred` and `sample` are empty.

```json
{ "status": "blocked", "planned": false, "headRevisionId": "rev-h1", "draftRevisionId": "rev-d1",
  "fingerprint": null, "counts": null, "coverage": [], "unmatched": null, "required": [], "deferred": [],
  "sample": [], "refusedTables": [], "blockers": [{ "code": "tooLarge", "message": "…" }],
  "estimate": { "changedRows": 120000, "mergedRows": 0, "perRowWorkRows": 0, "mixedTables": [] } }
```

Each call plans anew from the current Draft, so a transport that serves `preview` as a query keeps it out of client
caches: a caching client fetches it from the network on every call, or it shows an old plan and applies with an old
fingerprint.

A reason's `site` says where the requirement arises, and its `kind` fixes which ids it carries
([SPEC §5.1](specs/partial-changes-v1.spec.md#51-common-types)). At `selector`, `row` and `schema` sites, and for the
table of a `rowId` site, the ids are public ids, so a client joins the site to the Draft items by `tableId` and
`rowId`. The `rowId` of a `rowId` site and the `tableId` of a `tableId` site without `migrationId` are the id that two
rows or tables would hold in the target. At a `migration` site, and at a `tableId` site with `migrationId`, the ids are
those of the ledger at the migration's step: such a `tableId` can name a table that no longer exists, or another
current table. When the Draft creates `tx`, renames it to `ty` and creates another `tx`, committing the new `tx`
requires `ty` at a `tableId` site with `tableId: 'tx'`, the id of the new table; `because` names the ledger ids too. A
client links a reason at these two sites through public ids: the required `unit` and `cause.unit` carry them, and
`migrationId` is the `migrationId` of an entry of `schemaMigrations` of the table item whose pending migration it is
(`ty` here; a table created and removed in the Draft has no item, only its unit).

### changes.commit / changes.revert

```typescript
engine.changes.commit({
  branch: ChangesBranch;
  selection: SelectionInput;
  includeRequired?: boolean | null; // apply the required additions; requires `expected`
  expected?: string | null;         // the fingerprint of a commit preview of the same selection
  comment?: string | null;          // stored on the new Head revision, default ''
}): Promise<CommitChangesResult>

engine.changes.revert({
  branch: ChangesBranch;
  selection: SelectionInput;
  includeRequired?: boolean | null;
  expected?: string | null; // the fingerprint of a revert preview
}): Promise<RevertChangesResult>
```

Each attempt is one Serializable transaction that plans again from a fresh snapshot; nothing is written unless the
status is `applied`. Results by `status`:

| `status` | Fields |
| --- | --- |
| `applied` | `headRevisionId`, `draftRevisionId`, `applied` (`{ selected, required }`), `draftHasChanges` (whether the Draft still differs from Head). A commit also returns `previousHeadRevisionId` and `renumberedMigrations` (`{ from, to }[]`, pending migration ids it renumbered). |
| `required` | `required`: additions to accept with `includeRequired: true`, or to add to the selection by their `selector`. |
| `blocked` | `planned`, `blockers`, `required`; `unmatched` when `planned`. |
| `stale` | `changed`, the current `headRevisionId` and `draftRevisionId`, and the current `unmatched` (see [The fingerprint](#the-fingerprint-and-stale)). |
| `empty` | The current `headRevisionId` and `draftRevisionId`; `unmatched` when some selectors matched nothing. A repeat of an applied operation is `empty`. |

A commit turns the Draft revision into the new Head (`headRevisionId` is the former Draft revision id) and creates a
new Draft (`draftRevisionId`); later writes must use the new Draft id. A revert keeps both revisions: its
`headRevisionId` and `draftRevisionId` are those of the branch.

### Statuses

Decided in this order ([SPEC §5.6](specs/partial-changes-v1.spec.md#56-statuses)); `preview` skips step 3 and returns
`ready` at step 6:

1. a limit stopped the plan → `blocked` (`tooLarge`), whatever `expected` is;
2. no unit to apply and no blocker → `empty` (also when no selector matched anything: `unmatched` lists them all);
3. `expected` is given and differs from the current fingerprint → `stale`;
4. a blocker, or a selector that matched nothing (`unmatchedSelector`) → `blocked`;
5. required additions exist and `includeRequired` is not set → `required`;
6. otherwise → `applied` (`ready` for a preview).

`empty` comes before `stale`: a selection that no longer matches anything is `empty` even when `expected` is outdated,
for example when the Draft was committed natively between preview and apply.

Blockers ([SPEC §5.8](specs/partial-changes-v1.spec.md#58-blockers)):

| `code` | The caller |
| --- | --- |
| `requiredExcluded` | Drops the exclusion of `unit`, or the unit that needs it (`reason`). |
| `notSelectable` | Selects the inputs of the computed value instead. |
| `danglingInSource` | Changes the selection, or repairs the Draft natively. |
| `invalidRow` | Changes the selection. |
| `invalidViews` | Fixes the table's views natively. |
| `ledgerInconsistent` | Changes the selection, or repairs the Draft natively. Not returned for a ledger failure that a `requiredExcluded` of the same result causes: one blocker names the decision. |
| `unrecordedStructureChange` | Commits other units, or reverts the structure. |
| `headSchemaInconsistent`, `unledgeredTable` | See [Refused tables](#refused-tables). |
| `migrationInProgress` | Waits for the async migration (preview only; commit and revert fail with `MIGRATION_LOCKED`). |
| `unmatchedSelector` | Removes the selectors listed in `unmatched`. |
| `tooLarge` | Selects less (`tableId` is set for a per-table limit), or raises the limit ([ENV.md](../ENV.md)). |

### The fingerprint and `stale`

The fingerprint is an opaque string; compare it only for equality and never parse it. It covers the operation, the
Head and Draft revisions, the units to apply and their content. A preview's fingerprint passed as `expected` makes the
operation apply exactly what the preview showed, or return `stale` and write nothing. `changed` lists which parts
differ, in this order ([SPEC §9.2](specs/partial-changes-v1.spec.md#92-rules)):

| `changed` | Meaning |
| --- | --- |
| `version` | `expected` was issued under other fingerprint rules (another engine version); nothing else is compared. |
| `operation` | `expected` is the fingerprint of the other operation (a commit preview passed to a revert, or the reverse). |
| `revisions` | Head or the Draft is not the revision previewed: a commit happened since, or `expected` is of another branch. |
| `units` | The selection now resolves to other units, or the required additions changed. The content is not compared then. |
| `content` | The same units, and the content of at least one changed: a selected value edited again; a selected row's other content, or a selected schema, views or migration row, edited; or any row of a selected structure's table edited. |

A `stale` result carries no new fingerprint. The caller drops the selectors listed in `unmatched` (they no longer
match anything) and previews again, so the user reviews the new plan:

```json
{ "status": "stale", "changed": ["content"], "headRevisionId": "rev-h1", "draftRevisionId": "rev-d1",
  "unmatched": {} }
```

A request with `expected` is never applied twice: a repeat, also a concurrent one, is `empty`, or `stale` when its
selection now resolves to other units. A request without `expected` resolves its selection again on every call.

### Draft reads

```typescript
engine.changes.tableChanges({
  branch: ChangesBranch;
  first: number;           // 1–5,000
  after?: string | null;   // endCursor of the previous page
  filters?: { changeTypes?: ChangeType[] | null; search?: string | null } | null;
}): Promise<DraftTablePage>
// { edges: DraftEdge<DraftTableItem>[] ({ cursor, node }), pageInfo, totalCount, headRevisionId, draftRevisionId,
//   refusedTables }

engine.changes.rowChanges({
  branch: ChangesBranch;
  first: number;
  after?: string | null;
  filters?: { tableId?: string | null; changeTypes?: ChangeType[] | null; search?: string | null } | null;
}): Promise<DraftRowPage>
// { edges: DraftEdge<DraftRowItem>[], pageInfo, headRevisionId, draftRevisionId, refusedTables }

engine.changes.summary({
  branch: ChangesBranch;
  filters?: { changeTypes?: ChangeType[] | null; search?: string | null } | null;
}): Promise<DraftChangesSummary>
```

- **Items.** A table item has `tableId`, `previousTableId` (renamed), `changeType`, `replaced`, `rowsSummary`,
  `schemaMigrations`, `viewsChanges` and `selection`. A row item has `tableId`, `previousTableId`, `rowId`,
  `previousRowId` (renamed), `changeType`, `fields` (`path` as a JSON Pointer, `changeType`, `oldValue`, `newValue`,
  `selection`), `columns` (`publishedAt`, `meta`, `schemaHash`), `selection`, and `idTakeover` / `idExchange` when a
  rename took over another row's id. `changeType` takes the native `ChangeType` values.
- **Selection of an item.** A table is `selectable` (its `structure`, `views` and `tableData` selectors), `refused`
  (with the refusal `code`) or `contentEqual`. A row is `selectable` (`row` selects all its `units`), `goesWith` a unit
  that carries it (`reason`: `tableExistence`, `structureBound`, `rowExistence`), `computed` (only computed values
  differ) or `refused`. A field or column is `unit`, `goesWith`, `computed` or `refused`.
- **Paging.** Keyset pages: pass `pageInfo.endCursor` as `after` while `pageInfo.hasNextPage`. Each page reads its own
  snapshot. The two items of one row id are never split, so a row page can hold a few more items than `first`. A read
  refuses a cursor of the other read or of `changes.list` as malformed (400).
- **Totals.** `tableChanges` returns `totalCount` of the tables matching its filters. `rowChanges` returns no
  `totalCount`: it reads only the tables it needs for the page. Row totals come from `summary` (`rowsSummary` by
  change type, `rowsWithUnits`) or from a table item (`rowsSummary`, `tableData.rows`). The summary's counts are the
  Draft's totals and ignore `filters`; its filters apply to its three lists (shared schemas, transient tables,
  views-only tables), which no table item shows.
- **Filters.** `tableId` selects the rows of the tables listed under that id (both tables of a replaced id).
  `changeTypes` matches the change type; `RENAMED` and `MODIFIED` also match `RENAMED_AND_MODIFIED`, and an empty list
  matches nothing. `search` is a case-insensitive plain substring of the Draft or Head id of the row (`rowChanges`) or
  table.

The Draft reads never run the native diff queries of [Revision Changes](#revision-changes-diffs), so they do not join
every row of both revisions.

### Refused tables

Partial operations refuse a table whose stored history they cannot trust. `changes.list`, `changes.preview` and the
Draft reads list it in `refusedTables` with a `code`. Its units are not computed: `changes.list` lists none, and the
Draft reads show its items as `refused`. A preview, commit or revert whose selection involves it is `blocked` with a
blocker of the same code. Exactly `{ all: true }` and the
native `createRevision` and `revertChanges` still work.

- `unledgeredTable`: the table has no intact migration history. On a branch without a migration table (projects
  created before core v2.0.0, and their clones) every table is refused; run
  [`backfillSchemaLedger`](#backfillschemaledger) once on the branch.
- `headSchemaInconsistent`: the Head schema does not match its migration history (damage left by an async migration
  before the fix). Run [`repairSchemaLedger`](#repairschemaledger) and publish the repair with a native or exactly
  `{ all: true }` commit.

### Errors

| Condition | Error |
| --- | --- |
| Malformed input: an unknown selection field, a wrong type, an empty id, a `path` that is not a JSON Pointer, `includeRequired: true` without `expected`, a `pageSize` or `first` out of range, a malformed cursor, a filter of a wrong type | `BadRequestException` (400), before any transaction |
| A malformed `expected`, including the bare SHA-256 hex fingerprints of engines before this API | `BadRequestException` (400): `expected must be a fingerprint` |
| `changes.list` with a `tableId` that names no Head or Draft table | `BadRequestException` (400) |
| Unknown project or branch | The native `BadRequestException`: `A branch with this name does not exist in the project` |
| `commit` or `revert` while an async migration runs on the branch | `MIGRATION_LOCKED` (423) |
| `commit` or `revert` that waited too long for the branch write fence | `BRANCH_WRITE_FENCED` (423) |
| An operation past `PARTIAL_CHANGES_OPERATION_TIMEOUT_MS` | `OPERATION_TIMEOUT` (408) |
| Serialization failures on every attempt (`PARTIAL_CHANGES_MAX_ATTEMPTS`) | The last serialization error |

`MIGRATION_LOCKED`, `BRANCH_WRITE_FENCED` and `OPERATION_TIMEOUT` are NestJS `HttpException`s with the `code` in
their response body. Exhausted attempts surface the database's serialization error (a Prisma `P2034`, the
PostgreSQL `40001` / `40P01`, or an error whose message carries the database's serialization or deadlock text), which
a host maps to a retryable response. A failed operation is rolled back and persists nothing, so a retry is safe.

### Code lists

Every code union of the API has a runtime list exported next to its type, and the type is derived from the list. A
transport builds its enums from these lists instead of copying the values, so a code the engine adds reaches it
without a hand-kept mirror:

`CHANGE_OPERATIONS`, `UNIT_KINDS`, `ROW_COLUMNS`, `SELECTOR_SIDES`, `STRUCTURE_TABLE_CHANGES`,
`STRUCTURE_FIELD_CHANGES`, `ANNOTATION_KEYWORDS`, `REQUIRED_REASON_CODES`, `REASON_SITE_KINDS`,
`REFERENCED_ENTITY_KINDS`, `CAUSE_ROLES`, `BLOCKER_CODES`, `REFUSAL_CODES`, `PREVIEW_STATUSES`, `APPLY_STATUSES`,
`STALE_CHANGES`, and for the Draft reads
`TABLE_SELECTION_STATES`, `ROW_SELECTION_STATES`, `FIELD_SELECTION_STATES`, `DRAFT_FIELD_CHANGE_TYPES`,
`GOES_WITH_REASONS`, `FOLLOW_REASONS`, `ID_EXCHANGE_TERMINATIONS`. The operations of the
[Schema Ledger](#schema-ledger) have their own lists.

The Draft read items also carry the native diff types, exported with them: `ChangeType`, `RowChangeDetailType`,
`RevisionChangeSummary`, `SchemaMigrationDetail`, `ViewsChangeDetail` and what they are built of. Which value each
list types, and how a typed transport maps the unions:
[SPEC §5.10](specs/partial-changes-v1.spec.md#510-facade-and-transports).

### Host integration

- **Permissions and audit.** The engine has no permission or audit layer. The reads and the preview show uncommitted
  Draft content, and the preview is the most expensive read; a host may require a Draft-level permission for them and
  limit concurrent previews per branch. The transport contract gives `commit` and `revert` the permissions of the
  native `createRevision` and `revertChanges`, and writes audit records for `applied` results only. The proposed
  names of the GraphQL, REST and MCP operations:
  [SPEC §5.10](specs/partial-changes-v1.spec.md#510-facade-and-transports).
- **Endpoints.** The engine tells a host nothing: its internal endpoint hook does nothing in this package, and there
  is no supported way to replace it (`EngineModuleOptions` has no option for it, and the package does not export
  it). A host that serves endpoints by revision does the work itself after the call returns, as after the native
  operations:
  - after an `applied` `changes.commit` or a `backfilled` [`backfillSchemaLedger`](#backfillschemaledger), the same
    follow-up as after native `createRevision`, because both move the Head and the Draft to other revisions:
    `headRevisionId` is the former Draft revision, now the Head, and `draftRevisionId` is a new Draft. In one
    transaction and in this order, move the endpoints bound to `headRevisionId` to `draftRevisionId`, then those
    bound to `previousHeadRevisionId` to `headRevisionId`; the other order, or repeating the moves after they
    committed, would carry the Head endpoints on to the Draft. Then drop what you cache for those revisions and
    refresh the moved endpoints;
  - after an `applied` `changes.revert`, refresh the endpoints bound to `draftRevisionId` (the Draft keeps its id),
    as after native `revertChanges`;
  - after a [`repairSchemaLedger`](#repairschemaledger) call with `dryRun: false` that returns a table with the
    outcome `repaired`, refresh the endpoints bound to `draftRevisionId`;
  - after an async migration swap, refresh the Draft's endpoints once you see it finished: `applyMigrations`
    returned `applied` for that update, or `getMigrationStatus` returns `null` (after a `failed` result from
    `applyMigrations`, a worker may still swap later, so poll). The swap changes the Draft's schema and rows, and
    nothing tells the host when it commits.

  A failure there does not undo the operation, which is already committed.
- **Low-level Draft writes.** Partial commit and revert rely on every other Draft writer running Serializable, as the
  facade writers do: PostgreSQL then aborts the side that read stale data, and the operation retries. A host that
  writes through the exported `DraftRevisionApiService` or its own `TransactionPrismaService` transaction must run
  that write Serializable (`TransactionPrismaService.runSerializable`); a write below Serializable isolation is
  unsupported next to partial operations, and a partial commit or revert running at the same time can lose it.
- **Orphan cleanup.** Partial commit and revert do not delete the row and table versions they unlink: reverted row
  versions, a Draft table version that a revert replaced, and a Draft migration table version that a commit
  renumbered stay in the database until the host runs `cleanOrphanedData`
  ([Cleanup](integration.md#cleanup-orphaned-data)). Until then, files of reverted rows stay counted in the file
  usage, as after a native `revertChanges`.
- **Database index.** The id-exchange and followed-rename queries of `changes.rowChanges` join `Row` by `createdId`
  and rely on the index `Row_createdId_idx` to find the other row versions of an identity. The index comes with the
  engine migration `20260815120000_add_row_history_indexes`, which no stable engine release contains yet. A host that
  carries its own database migrations, as revisium-core does, adds that migration before it serves the Draft reads
  ([integration.md](integration.md#prismaclient-injection)).
- **Limits.** Each operation reads only the tables its selection affects (`all: true` reads every table) and refuses
  work above its limits with `tooLarge`. The defaults are conservative; a host raises them through the environment
  once the operation logs show the real costs ([ENV.md](../ENV.md),
  [SPEC §11](specs/partial-changes-v1.spec.md#11-limits-and-configuration)).
  Every listing page, Draft read (`tableChanges`, `rowChanges`, `summary`), preview, commit and revert logs one
  structured entry (`Partial changes operation finished`) with its duration, outcome and attempts; a Draft read adds
  the page size asked and returned and the names of its filters. `backfillSchemaLedger` and `repairSchemaLedger` log
  the same kind of entry as `Schema ledger operation finished`, with `dryRun` and what they planned or wrote. Every
  entry goes through the NestJS logger with the context `OperationLog`
  ([SPEC §11.1](specs/partial-changes-v1.spec.md#111-operation-logs)).

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

## Schema Ledger

Maintenance operations on the schema migration ledger (the rows of `revisium_migration_table`). The host exposes them
to administrators; the engine has no permission layer. How they work: [migration.md](migration.md), which describes
the fields. The package exports the input and result types of the three operations and every object type their
results hold, so a host maps them without copying shapes:

| Operation | Input | Result and its parts |
| --- | --- | --- |
| `scanSchemaLedger` | `ScanSchemaLedgerData` | `SchemaLedgerScan`, `SchemaLedgerFinding`, `SchemaLedgerScanStats`; the finding details `UnledgeredDetail` (`BrokenLineage`), `ReplayFailure`, `DamagedTableDetail`, `RowSchemaHashMismatchDetail` (`MismatchedRowHash`) |
| `repairSchemaLedger` | `RepairSchemaLedgerData` | `SchemaLedgerRepair`, `TableRepair`, `InvalidRows`, `RenumberedMigration` |
| `backfillSchemaLedger` | `BackfillSchemaLedgerData` | `SchemaLedgerBackfill` (`BackfillNotNeeded`, `BackfillPlanned`, `BackfillCommitted`, `BackfillRefused`), `BackfillEntry`, `BackfillRefusal` |

Every code union of the results has a runtime list exported with the union type derived from it (`FINDING_CODES` and
`FindingCode`, and so on), named below for each operation.

### scanSchemaLedger

```typescript
engine.scanSchemaLedger({ // the argument is optional
  projectId?: string | null;
  branchName?: string | null; // requires projectId
  cursor?: string | null;
  limit?: number | null; // 1–1,000, default 50
  rowDiagnostics?: 'none' | 'headAndDraft' | 'all' | null; // default 'headAndDraft'
}): Promise<SchemaLedgerScan>
// { findings: SchemaLedgerFinding[]; nextCursor: string | null; stats: SchemaLedgerScanStats }
```

Reports, read-only, where a revision's ledger does not reproduce its schema rows: one branch, the branches of a
project, or every branch, paged by branch. Codes: `FINDING_CODES`, `FINDING_ROLES`, `UNLEDGERED_REASONS`,
`DAMAGE_SHAPES`, `DAMAGED_TABLE_REPAIRS`, `ROW_HASH_REASONS`, `ROW_DIAGNOSTICS`, and `MIGRATION_CHANGE_TYPES` for the
`step` of an `unreplayableLedger` finding. Errors: a validation error (400) for wrong input types (`projectId must be a
string`, `cursor must be a string`, …), `branchName` without `projectId`, a malformed `cursor` or `limit`, or an
unknown `rowDiagnostics`; unknown project or branch. See
[How does the schema ledger scan report damage?](migration.md#how-does-the-schema-ledger-scan-report-damage)

### repairSchemaLedger

```typescript
engine.repairSchemaLedger({
  projectId: string;
  branchName: string;
  tableIds?: string[] | null;
  dryRun?: boolean | null;
}): Promise<SchemaLedgerRepair>
// { headRevisionId: string; draftRevisionId: string; dryRun: boolean; tables: TableRepair[];
//   renumbered: RenumberedMigration[] }
```

Records a forward-only repair of damaged Head tables in the Draft; a later commit publishes it. A call with
`dryRun: false` that returns a `repaired` table has changed the Draft, so the host refreshes the Draft's endpoints
([Host integration](#host-integration)). Outcomes: `REPAIR_OUTCOMES`, `TABLE_REPAIR_OUTCOMES`. Errors: a validation
error (400) for wrong input types, before any transaction (`projectId must be a string`, `branchName must be a string`,
`tableIds must be an array of strings`, `dryRun must be a boolean`), or for an unknown table id; unknown project or
branch; `MIGRATION_LOCKED` (423) while an async migration is active. Each call logs one structured entry
(`Schema ledger operation finished`,
[partial-changes §11.1](specs/partial-changes-v1.spec.md#111-operation-logs)). See
[How is the schema ledger repaired?](migration.md#how-is-the-schema-ledger-repaired)

### backfillSchemaLedger

```typescript
engine.backfillSchemaLedger({
  projectId: string;
  branchName: string;
  dryRun?: boolean | null; // default false
  comment?: string | null; // default 'Backfill the schema ledger'
}): Promise<SchemaLedgerBackfill>

type SchemaLedgerBackfill =
  | { status: 'notNeeded'; headRevisionId: string; draftRevisionId: string }
  | { status: 'planned'; headRevisionId: string; draftRevisionId: string; entries: BackfillEntry[] }
  | {
      status: 'backfilled';
      previousHeadRevisionId: string;
      headRevisionId: string;
      draftRevisionId: string;
      entries: BackfillEntry[];
    }
  | {
      status: 'refused';
      headRevisionId: string;
      draftRevisionId: string;
      refusal: BackfillRefusal;
    };

type BackfillRefusal = {
  code: 'draftStructureChanged' | 'schemaNotReproducible';
  tableIds: string[];
  message: string;
};

type BackfillEntry = {
  id: string;
  changeType: 'init' | 'update';
  tableId: string;
  hash: string;
};
```

Gives a branch whose Head has no migration table (projects created before core v2.0.0 and their clones) one: a commit
whose only change is a migration table with an `init` for every Head user table, plus `update` entries that close
foreign-key cycles. The new Draft keeps the Draft's changes and links the same migration table. Partial commit and
revert stop refusing the branch's tables, and native writers record schema changes from then on. `dryRun: true`
returns `planned` and writes nothing; its ids are provisional. A branch whose Head has a migration table gets
`notNeeded`, so a repeated call is safe. `backfilled` is a commit: the host moves and refreshes endpoints as after an
applied `changes.commit` ([Host integration](#host-integration)). The variants are `BackfillNotNeeded`,
`BackfillPlanned`, `BackfillCommitted` and `BackfillRefused`. Codes: `BACKFILL_STATUSES`, `BACKFILL_REFUSAL_CODES`,
`BACKFILL_CHANGE_TYPES`. Errors: a validation error for wrong input types (before any transaction), unknown project
or branch, `MIGRATION_LOCKED` (423) while an async migration is active (a dry run too), `BRANCH_WRITE_FENCED` (423, a
run only), `OPERATION_TIMEOUT` (408). Each call logs one structured entry (`Schema ledger operation finished`).
See [How is a missing schema ledger backfilled?](migration.md#how-is-a-missing-schema-ledger-backfilled)

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
