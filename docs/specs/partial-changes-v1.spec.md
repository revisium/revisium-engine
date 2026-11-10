# Partial Changes Specification v1

## Overview

| Property | Value |
| --- | --- |
| Version | 2.0 |
| Status | Accepted; the API revision of v2.0 is in delivery ([ADR-002] delivery): PR 1, the selection vocabulary, landed (#175); PR 2, views follow the structure, landed (#178); PR 3, annotated structure descriptions, landed (#181); PR 4, reason sites and causes, landed (#184); PRs 5–7 and 12 are pending |
| Date | 2026-11-10 |
| Parent ADR | [ADR-001](../adr/ADR-001-partial-commit-and-revert.md), amended by [ADR-002](../adr/ADR-002-draft-reads-and-public-changes-api.md) |
| Requirements | [REQ-001](../requirements/REQ-001-partial-commit-and-revert.md): REQ-001.BR-001 … REQ-001.BR-009; REQ-001.BR-006 and REQ-001.BR-008 are withdrawn |
| Evidence | [research/partial-changes-poc-v2.md](../research/partial-changes-poc-v2.md) (PoC v2, `c86e86c`, tag `archive/partial-changes-poc-v2`); the Draft changes PoC (engine `poc/draft-diff` `ddb22c6`, core and admin `poc/partial-changes`) for v2.0 |

This specification defines partial commit and partial revert of Draft changes in revisium-engine: the operations
`listChanges`, `previewChanges`, `commitChanges` and `revertChanges`, the unit and selection model, the assembly
algorithm, storage effects, transactions, freshness, migration history, limits and the native prerequisites. It
applies to the current versioning engine ([ADR-0003]). The design was proven by PoC v2 (milestones M1–M5); §14
summarises the evidence. The reads that show the Draft with how each change is selected are specified in
[draft-reads-v1](draft-reads-v1.spec.md).

Version 2.0 is the public API revision of [ADR-002]: it changes the selection vocabulary, the reasons, the plan
results, the views unit and the fingerprint, and names the exported types. Until all of its delivery PRs land, the
code on master follows version 1.3 except what the landed PRs implement (Status); the changelog lists every difference.

**Engine background** ([ADR-0003]). A revision links table versions and
a table version links row versions (both many-to-many); tables and rows carry `versionId`, `createdId` and `id`.
Committed versions are readonly and shared; a Draft edit copies the version it changes first. Schemas with their
history, the migration ledger, views and shared schemas are rows of system tables in the same revision. Native
commit turns the Draft revision into Head and creates a child Draft linking the same table versions; native revert
links the Head table versions into the Draft. Native row, schema and views writers run Serializable and take no row locks;
async-migration copy batches do not run Serializable (§12).

## 1. Terms

| Term | Meaning |
| --- | --- |
| Head, Draft | The branch revisions with `isHead = true` and `isDraft = true`. |
| Version | A `Table` or `Row` record, identified by `versionId`. |
| Identity | `createdId`. A table is identified by its `createdId`; a row by its table's `createdId` and its own `createdId`. |
| Public id | `id` of a table or row; renamable; may be reused by another identity. |
| Unit | The smallest selectable change (§3). |
| Applied units | Selected units plus required additions. |
| Taken from the Draft | A unit whose Draft side ends up in the target: in a commit an applied unit, in a revert a unit that is not applied. |
| Base side, other side | Commit: Head and Draft. Revert: Draft and Head. |
| Structure side | Per table: Draft if its structure unit is taken from the Draft, otherwise Head. A table without a structure unit uses the base side. |
| Target | The assembled result: the new Head (commit) or the reverted Draft (revert). |
| Remaining Draft | The new Draft after a commit. |
| Compared columns | The row columns that define content: `id`, data (`hash`), `publishedAt`, `meta`, `schemaHash` (§3.1). Change detection applies the structure exceptions of §3.1; the content check, the fingerprint and the structure digest use all five in full. |
| Content check | SQL comparison of two table versions: equal when no row identity is on one side only and no pair differs in `id`, `hash`, `schemaHash`, `publishedAt` or `meta`. |
| Mixed table | A table whose target needs a new or edited table version. |
| Merged row | A new row version that combines both sides or moves a row between two structures. |
| Affected tables | The tables an operation reads changed rows of (§6.2). |
| Unread table | A user table present on both sides with different table versions that is not affected: the operation neither reads its rows nor changes its links. |
| Refused table | A damaged or unledgered table (§6.10): partial operations compute no units for it and never assemble or relink it. |

## 2. Requirement coverage

| Requirement | Rule (summary) | Covered by |
| --- | --- | --- |
| [REQ-001.BR-001] | People (admin UI), programs (API, CLI) and agents (MCP) get the same capability. | One engine contract for every caller (§5); exact selectors for listed, required and blocking units; the public API and MCP require `expected` (§5.10). |
| [REQ-001.BR-002] S1, S2 | Publish what is ready; undo a mistake. | `commitChanges` and `revertChanges` with a selection. |
| [REQ-001.BR-002] S3 | Several people in one branch. | Units per edit, freshness by `expected` (§9), Serializable concurrency (§8). |
| [REQ-001.BR-002] S4 | Structure and content in parallel. | Edits of unchanged fields are units independent of the table's structure unit (§3.3). |
| [REQ-001.BR-002] S5 | A set prepared in advance and published at a chosen moment. | The layer above keeps a selection and applies it at the chosen moment with preview and `expected`. |
| [REQ-001.BR-003] | Commit or revert a selected part of the Draft; everything else stays in the Draft. | Every Draft difference belongs to a unit (§3.1); only applied units change the target; a table is relinked only when the content check finds it equal (§6.7). |
| [REQ-001.BR-004] | Every committed revision (and the Draft after a revert) is consistent; a breaking selection is explained with what to add or remove; an environment syncing through migration export accepts every partial commit and every later commit. | Dependency closure (§6.6), validation (§6.9), the Head schema check (§6.10), ledger and replicas (§10), reasons and blockers with exact selectors (§5.1, §5.7, §5.8). |
| [REQ-001.BR-005] | Whole-Draft commit and revert work as before. | Native operations unchanged; exactly `{ all: true }` equals native commit and revert, also on a damaged project (§6.10, §13.5), except for the inconsistency it would introduce that §6.10 item 4 lists. |
| [REQ-001.BR-007] | A data edit is one field; creating or deleting a row is the whole row; all structure changes of a table are one unit with the values of new or changed fields; a new table is committed whole. | Unit model (§3). |
| [REQ-001.BR-009] | An engine primitive; change sets, scheduling and UI are a layer above. | Engine operations only; selections are passed in. |

## 3. Unit model

### 3.1 Change detection

- Tables of Head and Draft are paired by identity. A table on one side only is created (Draft only) or removed
  (Head only).
- For a table on both sides with different table versions, the changed rows are found by an anti-join of the two
  link sets, then paired by row identity. A pair is changed when one side is missing or a compared column differs,
  with the structure exceptions below.
- Every Draft difference a native read exposes belongs to exactly one unit. Each differing column of a changed row
  has one owning unit:

| Column | Compared | Owning unit when it differs |
| --- | --- | --- |
| `id` | yes | `rowRename` |
| `data` (`hash` = native hash of `data`) | yes; when the structure differs, only at unchanged leaves (§3.3) | the `field` unit of the leaf; values of changed leaves belong to the structure unit |
| `publishedAt` | yes, unless the published-at field is new or changed by the structure | see below |
| `meta` | yes | `rowColumns` |
| `schemaHash` | only when the structure is unchanged | `rowColumns` (native writers set the current schema hash on every write, but a native rename of a referenced table leaves the referrer rows with the previous one); when the structure differs it follows the structure |

- **`publishedAt` ownership.** Native writers fill the column from a `RowPublishedAt` value of the written data and
  store `''` in every `RowPublishedAt` data leaf, so `hash` never shows it. The *published-at field* exists only when
  the Draft schema has exactly one `RowPublishedAt` leaf and that leaf is outside arrays. This keeps ownership
  unambiguous whichever value native picks.
  - The published-at field is unchanged (§3.3) → the `field` unit at its pointer owns the column.
  - The published-at field is new or changed → the structure unit owns it; the column follows the structure side and
    is not compared (as changed leaves).
  - No published-at field (no `RowPublishedAt` leaf, several of them, or one inside an array) → the `rowColumns`
    unit owns the column. Arrays stay atomic: a `RowPublishedAt` inside an array is part of the array's value; with
    several leaves outside arrays, each is a computed leaf (§3.2).
- **Not compared**, because they are not content: `versionId`, `updatedAt` and `readonly` (set by the writer,
  copy-on-write and commit locking), `createdId` (the identity), `createdAt` (never changes for one identity), and
  the file blob links (derived from `data` by the file-usage owner; they follow the unit that owns the file field).
  Versions that differ only in these are content-equal (§3.8).
- **Classification test (required).** A test lists every field of the `Row` and `Table` models and fails unless each
  one is classified as compared or not compared (for `Table`: `id` is compared as the table's public id and the
  `rows` links through the content check; `versionId`, `createdId`, `readonly`, `system`, `createdAt` and `updatedAt`
  are not). A column
  that a future native writer sets and nobody classifies would be invisible to change detection and to the content
  check (§6.7), so it would have no unit and a relink could drop it; the test makes such a column fail the build
  instead of being missed silently.
- Rows that differ only at changed leaves, in a structure-bound `publishedAt` or in `schemaHash` under a changed
  structure are not loaded; they follow the structure side wholesale.

### 3.2 Leaves of a row

The table schema is walked through object `properties`. A node that is not such an object is a leaf:

| Leaf | Schema | Unit |
| --- | --- | --- |
| Value | plain value | `field` unit at its pointer |
| Atomic | `type: array`; `$ref` to the File schema | one `field` unit for the whole value |
| Published-at | the published-at field (§3.1): the only `$ref` to `RowPublishedAt` of the schema, outside arrays | `field` unit whose value is the row's `publishedAt` column (data keeps `''`) |
| Computed | `x-formula`; a `RowPublishedAt` leaf when the schema has several; any other system `$ref` (row id, created id, version id, created at, updated at, hash, schema hash) | none; follows its inputs |

Paths are JSON Pointers (RFC 6901) into the row data.

### 3.3 Unchanged and changed fields

A Draft leaf is **unchanged** by the structure when all hold:

1. it exists in both the Head and the Draft schema at the same pointer;
2. its leaf schemas are equal after normalisation: `title`, `description` and `deprecated` are ignored, and a
   `foreignKey` is compared by the identity of the referenced table (so a referrer rewritten by a table rename stays
   unchanged);
3. no pending migration of the table touches its path or an ancestor: any `add`, `remove`, `replace` or `move` patch
   (both `from` and `path` of a move) at the leaf's pointer or above it. A patch path is mapped to the data pointer it
   affects before this check, by the replay that describes the structure (§5.2): each path is read against the schema
   its patch applies to, and a path inside an atomic leaf's schema (array `items`, the File schema) touches that leaf,
   because the leaf's value is one unit (§3.2). When the pending patches of the table do not replay, each path is
   mapped by its leading `/properties/<name>` segments alone: a path into array `items` still maps to the array, while
   a path inside the File schema maps below the File leaf and touches no leaf.

Every other leaf of either schema is a **changed** (structure-bound) field. Its values belong to the table's structure
unit (REQ-001.BR-007), also when a later patch restored the leaf schema (values the migration converted stay with the
structure).

### 3.4 Unit kinds

| Kind | Exists when | Public fields | Covers |
| --- | --- | --- | --- |
| `field` | A row on both sides differs at an unchanged leaf, or in `publishedAt` while the published-at field is unchanged. | `tableId` (Draft id), `rowId` (Draft id), `path` | The value at that leaf (for the published-at field, the `publishedAt` column). |
| `rowCreate` | A row identity exists only in the Draft and no Head-only row of that table has its id. | `tableId`, `rowId` | The whole row. |
| `rowDelete` | A row identity exists only in Head and no Draft-only row of that table has its id. | `tableId`, `rowId` (Head id) | The whole row. |
| `rowReplace` | A Head-only and a Draft-only row identity share one id in one table. | `tableId`, `rowId` | Deletion of the old row and creation of the new one. |
| `rowRename` | A row on both sides has different ids. | `tableId`, `rowId` (Draft id), `previousRowId` (Head id) | The id change only; field and row-column edits of the row stay separate units. |
| `rowColumns` | A row on both sides differs in a column no field or structure unit owns (§3.1): `publishedAt` when the Draft schema has no published-at field, `meta`, or `schemaHash` under an unchanged structure. | `tableId`, `rowId` (Draft id, else Head id), `columns` (the differing columns it owns) | Those columns of the row, as one unit: the technical columns of the row, which `rows` and `tableData` include. |
| `structure` | The table is created, removed or renamed; its schema row differs in data or history; or pending migrations are attributed to it. | `tableId` (Draft id, else Head id), `previousTableId` (Head id when renamed) | See §3.5. |
| `views` | The table has no structure unit and its Draft views document differs from its Head document. | `tableId` (Draft id) | The whole views document of the table. |
| `sharedSchema` | A row of the shared schemas table differs. | `sharedSchemaId` (v2.0; before, `tableId` carried it) | That shared schema. |

### 3.5 Structure unit

One unit per table identity. It covers:

- the table's existence and public id (create, remove, rename);
- its schema row with the schema history;
- the pending migrations attributed to the table (§10.1);
- the values of changed fields in every row of the table, including `publishedAt` when the published-at field is new
  or changed, and `schemaHash` when the structure differs;
- the table's views document: the changes that follow from its migrations and the independent views edits alike
  (§3.6);
- all rows of a created or removed table ("committed whole");
- the histories of tables created and removed inside the Draft that used one of its ids.

A removed and re-created table id is one structure unit. Tables created and removed inside the Draft (transient)
leave only pending migrations: their histories are grouped by the table ids they used; a group that shares an id
with a table that has a structure unit joins that unit, otherwise the group is one structure unit addressed by its
id.

### 3.6 Views and shared schemas

- **Views follow the structure.** A table with a structure unit has no views unit: its views document travels with
  the structure unit, whether the Draft document differs from Head through the table's migrations, an independent
  edit or both. Committing the structure commits the Draft document; reverting it restores the Head document.
- A views unit exists only for a table on both sides without a structure unit. Such a table has the same structure on
  both sides (the same schema row and history, and no pending migration), so the Head and the Draft document both fit
  it, and the views unit is the whole Draft document when it differs from the Head document.
- So a view edit cannot be applied while a schema change of the same table stays in the Draft, or the reverse. The
  closure needs no check that views fit a structure from the other side, and no views document is migrated between
  sides; a document that does not fit the structure of its own side is native damage (`invalidViews`, §6.9).
- Shared schemas are independent units. Tables cannot reference shared schemas in the engine yet, so there is no
  dependency between a shared schema and tables (out of scope, §16).

### 3.7 Identities and public ids

- **Replace.** A deleted and re-created row id is one `rowReplace` unit; a removed and re-created table id is one
  structure unit.
- **Rename.** A row rename is a `rowRename` unit, selected alone by `rowRenames`; its field and row-column edits are
  separate units addressed by the Draft id. A field edit committed without the rename lands under the Head id.
- **Swap and takeover.** A swap of two ids is two renames that require each other (`idOccupied`). A rename into an id
  vacated by a deletion requires that deletion. The deleted row or removed table whose id a rename took over is
  addressed with `side: 'head'`. The same rules hold for tables.

### 3.8 Content-equal versions

A Draft row version equal to its Head version on all compared columns is not a unit. Native `hasChanges` compares
versions, so it stays `true` for such a Draft. `all: true` on a Draft whose only differences are content-equal
versions returns `empty`, while native `createRevision` would create a revision. After an applied operation such
versions are dropped by relinking (§6.7) only in the tables the operation read; unread tables keep them, so
`hasChanges` can stay `true` after a partial operation leaves no unit (native semantics). `all: true` reads every
table and normalises them. v1 adds no separate content-equality pass for unread tables.

## 4. Selection

### 4.1 Fields

Every field is optional. The selection is the union of all items minus the exclusions. Every item field is a list of
one shape, so a transport can type it (§5.10).

| Field | Type | Selects |
| --- | --- | --- |
| `all` | boolean | Every unit of the Draft. |
| `structures` | `{ tableId: string; side?: 'head' }[]` | The structure unit of each table. |
| `tableData` | `string[]` | Every row unit (`rowCreate`, `rowDelete`, `rowReplace`, `rowRename`, `rowColumns`) and `field` unit of each table that exists on both sides. |
| `views` | `string[]` | The views unit of each table. |
| `sharedSchemas` | `string[]` | The unit of each shared schema id. |
| `rows` | `{ tableId: string; rowId: string; side?: 'head' }[]` | Every unit of each row: existence or replace, rename, fields, `rowColumns`. |
| `rowRenames` | `{ tableId: string; rowId: string; side?: 'head' }[]` | Only the `rowRename` unit of each row; field edits of that row, including later ones, are not selected. |
| `rowColumns` | `{ tableId: string; rowId: string; side?: 'head' }[]` | Only the `rowColumns` unit of each row. |
| `fields` | `{ tableId: string; rowId: string; path: string }[]` | The field units at or below each JSON Pointer. |
| `exclude` | the item fields above, without `all` and `exclude` | Units removed from the selection. |

`structures` was `tables`, which also took a bare table id; `rowRenames` was `renames` (v2.0). `structures` does not
select the table's rows, and `tableData` does not select its structure; a table with a structure unit has no views
unit, so its views are selected with its structure (§3.6).

### 4.2 Id resolution

- A table id resolves to the Draft table with that id, else the Head table with that id; for `structures` only, else a
  transient structure unit with that id. With `side: 'head'` only Head tables are searched.
- A row id (`rows`, `rowRenames`, `rowColumns`, `fields`) resolves inside the resolved table to the Draft row with that
  id, else the Head row with that id. With `side: 'head'` only Head rows are searched.
- After a concurrent rename, a selector can resolve through the Head id to another identity; `expected` (§9) detects
  it. Callers that apply what they reviewed pass `expected`.

### 4.3 Normalisation

| Selector targets | Result |
| --- | --- |
| A row or field of a created or removed table, or `tableData` of such a table | Requires the structure unit (`structureBoundData`). |
| `views` of a table that has a structure unit | When its Draft views document differs from its Head document (stored under the Head id in Head and the Draft id in Draft): requires the structure unit (`structureBoundData`), which holds the document (§3.6); otherwise unmatched. |
| A field of a created, deleted or replaced row | Requires the row's existence unit (`wholeRowUnit`). |
| A pointer to an object | Selects the field units inside it. |
| A pointer inside an array or file value | Requires the field unit of the whole value (`atomicValue`). |
| A pointer at, inside or above a changed field | Requires the structure unit (`structureBoundData`), and selects the unchanged field units under it. |
| A pointer to a computed leaf | Blocker `notSelectable`. |

### 4.4 Exclusions

`exclude` items resolve like included items. Excluded are the units they select and the units their normalisation
would require: an excluded pointer inside an array excludes the array's unit; an excluded field of a created row
excludes the creation; an excluded `views` of a table with a structure unit excludes the structure unit when the
table's views document differs, and is unmatched otherwise. The closure never adds an excluded unit; if one is needed, the result has the blocker `requiredExcluded`.

### 4.5 Unmatched selectors

A selector, included or excluded, that matches no unit is returned in `unmatched` (`UnmatchedSelectors`: the item
fields, with `exclude` nested, as typed as the input). If nothing matched at all the status is `empty`; if some
selectors matched and others did not, the status is `blocked` with `unmatchedSelector`. A plan that a limit stopped
has no `unmatched` (`null` in a preview, absent in an apply result, §5.3).

## 5. Operations

Callers: the engine facade (`changes` namespace, §5.10), and through it the admin UI, public API, CLI and MCP
(REQ-001.BR-001). The engine features that plan and write, and their responsibilities, are defined in
[ADR-001, Modules and Interactions](../adr/ADR-001-partial-commit-and-revert.md#modules-and-interactions).

**Optional input fields.** An optional input field of `listChanges`, `previewChanges`, `commitChanges` or
`revertChanges` given as `null` is treated as absent, at any depth: the optional fields of the input, every field of a
`Selection` (§4.1) and of its `exclude`, and `side` of a selector that has it. A transport that sends `null` for an
omitted argument (as GraphQL clients do) needs no mapping. Required fields stay required: one given as `null` is refused
as if omitted. Only declared fields are optional: a field the object does not have stays malformed when given as
`null` (§5.9), for example an unknown selection field, `all` or `exclude` inside `exclude`, or `path` of a `rows`
selector.

### 5.1 Common types

**ChangesBranch** `{ projectId: string; branchName: string }`, required in every operation; the operations act on its Head
and Draft.

**Unit** (public form), discriminated by `kind` (§3.4); each kind has exactly its fields, all required unless marked:

| `kind` | Fields |
| --- | --- |
| `field` | `tableId`, `rowId`, `path` (JSON Pointer of the leaf) |
| `rowCreate`, `rowDelete`, `rowReplace` | `tableId`, `rowId` |
| `rowRename` | `tableId`, `rowId` (Draft id), `previousRowId` (Head id) |
| `rowColumns` | `tableId`, `rowId`, `columns` (the differing columns the unit owns) |
| `structure` | `tableId`, `previousTableId?` (Head id of a renamed table) |
| `views` | `tableId` |
| `sharedSchema` | `sharedSchemaId` |

`tableId` is the Draft table id, else the Head table id; `rowId` the Draft row id, else the Head row id. A shared schema
unit has no `tableId`: before v2.0 its `tableId` carried the shared schema id.

**UnitRef** = Unit plus `side?: 'head'` and `selector: SelectionItems`, with the same meaning as in ListedUnit
(§5.2): a selector that resolves to exactly this unit, so a caller can add it, or exclude it, by public ids alone (also
a Head-side unit whose id a rename took over). Every selector a result returns is `SelectionItems` (§4.1 without `all`
and `exclude`), so it can be added to `exclude` as it is.

**DescribedUnitRef** = UnitRef plus `structureChange?: StructureChange` (§5.2), set on structure units only. Every unit
a result names is a DescribedUnitRef: the listed units (§5.2), and `required`, `deferred` (`unit` and `structure`),
`sample`, the `unit` of a blocker and the `unit` of a reason's `cause` in the results of `previewChanges`,
`commitChanges` and `revertChanges`. A structure unit carries the same `structureChange` in each of them, so a caller
explains a preview or a refused apply without listing the Draft. Only the link `ListedUnit.structure` stays a UnitRef:
the listing lists that structure unit itself, with its `structureChange`.

**RequiredUnit** `{ unit: DescribedUnitRef; reason: RequiredReason }`. One reason per unit (the first found).

**RequiredReason** `{ code: RequiredReasonCode; because: string; site: ReasonSite; references?: ReferencedEntity;
cause?: ReasonCause }` (§5.7):

- `site` is where the requirement arises. Its `kind` fixes what its fields mean, whatever the code:

  | `site.kind` | Fields | The place |
  | --- | --- | --- |
  | `selector` | `tableId`, `rowId?`, `path?` | A selected value that is no unit of its own: the selector's table, row and pointer. |
  | `row` | `tableId`, `rowId`, `path` | A row that references another row, at the referring field (for a reference inside an array, the array's pointer). |
  | `schema` | `tableId` | A table schema whose foreign keys reference another table. |
  | `migration` | `tableId`, `migrationId` | A pending migration that references another table at its step. |
  | `rowId` | `tableId`, `rowId` | A row id that two rows would hold in the target. |
  | `tableId` | `tableId`, `migrationId?` | A table id that two tables would hold in the target, or at the step of a pending migration (`migrationId`). |

  At `selector`, `row` and `schema` sites, and for the table of a `rowId` site, ids are public ids as units carry them
  (Draft id, else Head id); `path` is a JSON Pointer. The `rowId` of a `rowId` site and the `tableId` of a `tableId`
  site without `migrationId` are the id the two rows or tables would hold in the target. At a `migration` site, and
  at a `tableId` site with `migrationId`, ids are those of the ledger at that step, which can be ids no table holds
  now (a table created and removed in the Draft): at a `migration` site `tableId` is the migration's own table id; at
  a `tableId` site it is the id the migration takes (the table id of an `init`, the new id of a `rename`).
  `migrationId` is the id the Draft ledger holds now, before any renumbering by the operation (§6.8). The units
  involved, the required unit and `cause.unit`, carry the public ids.
- `references` is what a `row`, `schema` or `migration` site references: `{ kind: 'row'; tableId; rowId }` (the
  referenced table as units address it, the row id the reference holds) or `{ kind: 'table'; tableId }` (the table id
  the foreign key holds at a `schema` site; at a `migration` site, the table id the step references, in the ledger's
  ids).
- `cause` is `{ unit: DescribedUnitRef; role: CauseRole }`: the applied unit (selected, or added before as required)
  whose application needs the unit to add, and how it stands to it (§5.7). It is absent at a `selector` site, which
  needs the unit by itself, and when no applied unit is the cause, for example at a ledger step that no applied
  unit's migration changed the id before (§5.7).
- `because` is the same requirement in English, for display and logs.

**Blocker** (exported as `PlanBlocker`) `{ code: BlockerCode; tableId?: string; rowId?: string; path?: string;
message: string; unit?: DescribedUnitRef; reason?: RequiredReason }`, deduplicated by code, table, row and path.
`unit` names the unit to remove or change when there is one: the excluded required unit for `requiredExcluded` (with
the `reason` that required it), the applied unit whose target would dangle for `danglingInSource`, the unit of an
invalid row for `invalidRow`.

**DeferredRow** `{ unit: DescribedUnitRef; defaulted: DeferredValue[]; omitted: DeferredPath[]; structure:
DescribedUnitRef }`: a created or replaced row committed without its table's structure. Its deferred paths are the changed input fields
of the row's table (§3.3), Draft and Head pointers. The Head schema the commit writes the row against decides what
happens to each: `defaulted` are the paths where it has an input field, `{ path; value }` with the value the commit
writes there, taken from the assembled row (the Head default, a type default after a native schema update); `omitted`
(`{ path }`, objects so that a reason can be added without a breaking change) are the others, where it has no field or computes the value, and the Draft value is left out. Each path is in exactly
one of the two lists, which keep the order of the changed fields. A moved field appears in both: its Draft pointer is
omitted, its Head pointer defaulted. `structure` is the unit that would carry the Draft values; the Draft keeps them.

**PlanEstimate** (§6.5; an upper bound: a merge that turns out content-equal to one side is still counted):

| Field | Type | Meaning |
| --- | --- | --- |
| `changedRows` | integer | Changed rows of the affected tables (§6.2). |
| `mergedRows` | integer | Merged or converted rows in mixed tables. |
| `perRowWorkRows` | integer | The part of `mergedRows` in tables whose target schema has formula or File fields. |
| `mixedTables` | `{ tableId: string; linksCopied: integer; linksAdded: integer }[]` | Per mixed table: row links copied into a new table version (0 for an in-place revert) and links added. |

A plan that a limit stopped (§6.2 step 5, §6.5) returns the estimate it measured up to the stop: after the changed-row
guard only `changedRows`, the other fields 0 and `mixedTables` empty.

**PlanCounts** `{ selected: integer; required: integer }`: selected units after exclusions, and required additions
(disjoint from them). Their sum is the number of units the operation applies with `includeRequired`. Results do not
count the units that stay in the Draft: an operation reads only its affected tables (§6.2), so such a count would be
partial. A client reads what stays from the Draft reads ([draft-reads-v1](draft-reads-v1.spec.md) §6); an applied
result says whether the Draft still has changes (§5.4).

**TableCoverage** `{ tableId: string; previousTableId?: string; side?: 'head'; structure?: boolean; views?: boolean;
rows: integer; appliedRows: integer; partlyAppliedRows: integer }`: how much of one user table a plan applies,
counting selected and required units alike, for every user table with an applied unit, ordered by `tableId` in
code-point order with a `side: 'head'` entry before the other entry of its id. A replaced table id has one entry, for
its one structure unit (its rows have no row units). Transient structure units and shared schemas have no entry; they
are counted in `counts` and named in `sample`.

- `tableId`, `previousTableId` and `side` address the table as its units do: `side: 'head'` for a removed table whose
  id a rename took over, so the two tables at one id have two entries;
- `structure` and `views` are present when the table has that unit, `true` when it is applied;
- `rows` is the number of rows with row or field units, each row counted by its row selector as
  `tableData.rows` of the Draft reads counts it ([draft-reads-v1](draft-reads-v1.spec.md) §4), except that a row
  whose only stored difference is a computed value has no unit and does not count here; every table with an applied
  unit is affected (§6.2), so its rows are known;
- `appliedRows` are the rows all of whose units are applied, `partlyAppliedRows` those with some but not all applied.

So a client shows a table's row changes as wholly in the plan when `appliedRows = rows`, without listing them.

### 5.2 `listChanges`

Pages the selectable units with exact selectors. Read-only.

Input:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `branch` | ChangesBranch | yes | |
| `tableId` | string | no | Only units of this table (Draft id, else Head id); an id of neither side is a validation error. |
| `cursor` | string | no | Opaque cursor from the previous page; a malformed cursor is a validation error. |
| `pageSize` | integer 1–5,000 | no | Units per page; default 500. |

Output:

| Field | Type | Meaning |
| --- | --- | --- |
| `headRevisionId` | string | Head read by this page. |
| `draftRevisionId` | string | Draft read by this page. |
| `units` | ListedUnit[] | Units in listing order; may hold fewer than `pageSize` units, or none. |
| `nextCursor` | string or `null` | Cursor of the next page; `null` only at the end of the listing. |
| `refusedTables` | `{ tableId: string; code: 'headSchemaInconsistent' \| 'unledgeredTable' }[]` | Every refused table of the branch (§6.10); their units are not computed or listed. |

**ListedUnit** = DescribedUnitRef (§5.1) plus `structure`:

| Field | Type | Meaning |
| --- | --- | --- |
| `side` | `'head'`, optional | The selector needs `side: 'head'` (an id taken over by a rename). |
| `structure` | UnitRef, optional | The structure unit of the same table, for other units of a table that has one. Its `selector` resolves to exactly that structure unit, so a caller adds the structure without building a selector. |
| `structureChange` | StructureChange, structure units only | What the structure unit consists of (below). |
| `selector` | SelectionItems | Resolves to exactly this unit with no required units, blockers or unmatched items: `fields` for a field, `rows` for row lifecycle units, `rowRenames` for a rename, `rowColumns` for row columns, `structures` for a structure, `views`, `sharedSchemas`. |

**StructureChange** `{ table: StructureTableChange; fields: ChangedField[]; views: boolean }` describes a structure
unit. The listing and the plan compute it from the table schemas, the views rows and the structure analysis that every
listing page and every plan already read and run for every table on both sides (§6.2 step 3), and read nothing more
for it. `views` is `true` when the unit carries a views change (§3.6): the Draft views document, stored under the
table's Draft id, differs from the Head document, stored under its Head id; a side without the table or without a
views row counts as no views. So a caller sees that applying the structure also applies a views edit.

| `table` | The structure unit holds |
| --- | --- |
| `created` | A table that exists only in the Draft. |
| `removed` | A table that exists only in Head. |
| `replaced` | A removed table and the table created at its id (§3.7). |
| `transient` | Only the pending migrations of tables created and removed inside the Draft (§3.5). |
| `changed` | A table on both sides whose structure differs (§3.4); a renamed table keeps `previousTableId`. |

**ChangedField** `{ path: string; change: 'added' | 'removed' | 'changed' | 'moved' | 'annotated'; from?: string;
annotations?: AnnotationKeyword[] }`. `path` and `from` are data JSON Pointers; `fields` names each `path` once, in
code-point order. A change inside an array or File value reads as the pointer of the whole value (§3.2). Only an
`annotated` entry carries `annotations` (below), and it never carries an empty list. An entry names a leaf, or, for a
change of an object's own annotations, that object (below).

The **annotations** of a leaf schema are the keywords of the schema toolkit that validate no value: `title`,
`description`, `deprecated`, `default`, `readOnly` and `contentMediaType` (the metadata and content vocabularies of
JSON Schema). Two leaf schemas **differ only in annotations** when they are equal once these keywords are removed at
every level and a `foreignKey` is compared by the identity of the referenced table.

For a `changed` table, `fields` describes the changed leaves of §3.3, input and computed alike, net of the table's
pending moves. The listing follows the value of every Head leaf through the pending patches of the table in ledger
order, replaying them as native applies them: the patches of one `update` migration apply in turn to one schema built
from the schema that migration starts from, and the next migration starts from the serialized result. Each patch path
is read against the schema that patch applies to. Within one migration that is the schema native holds between the
patches, not its serialized form: serializing a File keeps only its `$ref`, so a field that an earlier patch of the
migration added inside the File and a later one moved out of it exists only in the held schema. A path addresses a
data node when it descends from the root only through `/properties/<name>` of object schemas. A path that goes on
into an array, a File or another schema keyword lies inside the value where it stops; for example,
`/properties/asset/properties/fileName` lies inside the File at `/asset` while `/asset` is a File.

- A `move` whose `from` and `path` both address data nodes carries the values at or below `from` to the same place
  below `path`, and ends the other values at or below `path`. A chain of moves resolves to its first source: a→b→c
  gives `from: a`.
- Every other patch acts at each of its paths (both paths of a `move`). At a data node, a `replace` rewrites the values
  at or below it, and an `add`, a `remove` or a `move` ends them. A `replace` at a data node whose value is not the
  schema native serializes at that node, and which changes the schema native holds there only in annotations,
  annotates the values at or below it instead of rewriting them. That is decided on what native holds before and after
  the patch, both serialized (so every `$ref` counts) and with File contents (a field a patch added inside a File and
  the replace dropped is a rewrite). A `foreignKey` is compared by the identity of the referenced table, because the
  referrers of a renamed table record no patch: an id the schema held before the patch names is read as a Head id, else
  a Draft id, and an id the value names as a Draft id, else a Head id. An id that is neither, such as one between two
  renames of the referenced table, names no table, so that replace is a rewrite; describing it as `changed` is the
  conservative error. An id that an earlier pending replace wrote is still read as a Head id first, so after two
  referenced tables swapped their ids, a retarget and its return can read `annotated`. The values travel with the
  structure unit in every case. A path inside a value rewrites that whole value, so no value moves into or out of an
  array or File. Annotating a value touches its leaves as rewriting does (§3.3, condition 3).

A Draft leaf **comes from** the Head leaf whose value is at its pointer after these patches. Each Draft leaf is
described as follows:

- It comes from a Head leaf at another pointer: `moved` when its leaf schema equals that leaf's (§3.3, condition 2)
  and no patch rewrote or annotated its value, otherwise `changed`; `from` is the Head pointer. That Head pointer is
  not reported as `removed`.
- It comes from the Head leaf at its own pointer: not reported when its leaf schema is equal (§3.3, condition 2) and no
  patch rewrote or annotated its value (an unchanged leaf, or a move reverted inside the Draft). Otherwise, when no
  patch rewrote its value and its leaf schema differs from that leaf's only in annotations: `annotated` (a changed
  default, description or title), or not reported when the two leaf schemas are equal in every keyword (an enclosing
  object whose annotations changed, or an annotation that a patch sets and the stored schema does not keep).
  Otherwise `changed`.
- It comes from no Head leaf: `added` when Head has no leaf at its pointer or that Head leaf's value moved to another
  Draft leaf (a field added where a moved field was), otherwise `changed` (a field removed and added again).

A Head leaf with no Draft leaf at its pointer that no Draft leaf comes from is `removed`, at its Head pointer.

An `annotated` field lists in `annotations` the annotations whose values differ between its Head and its Draft leaf
schema, at any level of the leaf schema (the items of an array included), in code-point order: `['default']` for a
changed default, `['description', 'title']` for a field given a title and a description. Since the leaf schemas differ
only in annotations, these keywords are the whole difference, and at least one of them differs. Native schema updates
store the type's default for every primitive field (schema-toolkit 0.24.0): a default that a `replace` sets is not
kept, so the field is not reported, and an update resets the defaults given at table creation, which reads as
`annotated` with `['default']` on those fields.

An object (a node below the root walked through `properties`, §3.2) is no leaf, so its own annotations are described
apart from its leaves. A Draft object is reported `annotated`, at its pointer, when it comes from the Head object at
the same pointer (the replay carries an object as it carries a leaf, so a moved, removed or re-added object does not
come from it), a pending patch annotated or rewrote it, and the annotations of the object schema itself (not of its
properties) differ; `annotations` lists those keywords in code-point order. For example, a description given to
`/dims` reads `{ path: '/dims', change: 'annotated', annotations: ['description'] }`, and its unchanged fields are not
reported. Other changes inside the object are reported at their own pointers beside it: a field added to `/dims` and,
by a later patch, a new description of `/dims` give `/dims` (`annotated`) and `/dims/depth` (`added`); a field whose
own annotations changed in the same patch is `annotated` by its own keywords. One `replace` that both adds the field
and gives the description rewrites `/dims`, so its other fields read `changed` beside them. An array whose item object
got a description through a `replace` of the array is one atomic leaf (§3.2) and reads `annotated` with
`['description']`; a `replace` at its `items` lies inside the value and reads `changed`. A moved object reports no
annotations of its own: its leaves read `moved`, or `changed` when a patch annotated them. Without a replay (below),
for a `replaced` table and for the root schema, no object is reported.

Native accepted every pending migration, so a patch that this replay cannot apply means the replay diverged from
native. The listing then follows no value through the patches: `fields` compares the Head leaves with the Draft leaves
by pointer, as for a `replaced` table below, and reports no `moved` and no `from`.

The description does not change which leaves are structure-bound; §3.3 alone decides that. The source and the target
of a move, the pointer of a move reverted inside the Draft, an annotated field and every leaf below an annotated object
stay structure-bound: their values in every row travel with the structure unit, and a row that differs only there has
no unit of its own (§3.1). An annotated object is no unit and adds no value unit, and the deferred paths of a row
(§5.1) are its leaves, never the object.

For a `replaced` table, `fields` compares the leaves of the removed Head table with the leaves of the Draft table
created at its id: a leaf only in the Draft table is `added`, a leaf only in the Head table is `removed`, a leaf in
both is reported when the leaf schemas differ (§3.3, condition 2): `annotated` when they differ only in annotations,
otherwise `changed`. No ledger links the two tables, so no leaf is `moved`; every row of both tables still travels
with the unit. For `created`, `removed` and `transient` tables, `fields` is empty: the whole table is the unit.

`structureChange` is not part of a unit's identity, internal key or selector, or of the fingerprint (§9.1).

Order: the unit's table key (its `tableId`; for a shared schema unit, its `sharedSchemaId`), `rowId` (table-level
units first), `kind`, `path`, `previousTableId`, `previousRowId`, in code-point order, and finally the internal unit
key (carried in the cursor) so the order is total. The cursor carries the sort key of the last returned unit and the
table key and row to resume from. The same order is the unit order of `sample` and of the fingerprint (§9.1). The
`tableId` filter never lists shared schema units. The listing has no total: it would need every
table read.

Reading is incremental:

- Each page reads the table pairs and the system tables (as §6.2 steps 1–3), then the changed rows of one table at a
  time, in listing order from the cursor's table (only `tableId` when given), and stops as soon as the page is full.
  Tables after the last one it needed are not read.
- **Keyset paging inside a table (required).** A page reads the changed rows of a table in keyset order of the unit
  row id, starting at the cursor's row, and stops when the page is full or when it has read `pageSize` changed row
  ids across its tables. Each row id holds at most two row version pairs (a replaced id, or an id a rename took over
  from a deletion). A changed row can yield no unit, for example when its data differs only in a formula output that
  a native foreign-key rewrite left stale, so this read budget is separate from the unit count. A row whose units do
  not fit continues on the next page from the cursor. (The PoC still read every changed row of each table it
  listed.)
- **Per-page cost.** A page compares and loads only the row version pairs of the row ids it reads, but it still finds
  a table's changed rows by the anti-join of the table's two link sets, so each table a page reads costs time
  proportional to its row links. Measured in the sandbox on a pair of table versions with 1,000,000 rows: 1.1–1.2 s
  per page with 10 changed rows and 1.8–1.9 s with 100,000.
- Refused tables (§6.10) are not read for units; every page returns them in `refusedTables`.
- A page can hold fewer than `pageSize` units, or none; only `nextCursor = null` ends the listing.
- Paging is snapshot-free: each page reads its own snapshot and returns its Head and Draft ids; under concurrent edits
  units can move between pages. What is applied is bound by `expected`, not by the listing.

### 5.3 `previewChanges`

Dry run of a commit or revert. Read-only.

Input:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `branch` | ChangesBranch | yes | |
| `operation` | `'commit' \| 'revert'` | yes | The operation to plan. |
| `selection` | Selection | yes | §4. |
| `includeRequired` | boolean | no, default `false` | Treat required additions as accepted (affects only `status`). |

Output:

| Field | Type | Meaning |
| --- | --- | --- |
| `status` | `'ready' \| 'required' \| 'blocked' \| 'empty'` | §5.6. |
| `planned` | boolean | `true` when the plan ran to its end; `false` only when a limit stopped it (`tooLarge`, §6.2 step 5, §6.5), and then `status` is `blocked`. |
| `headRevisionId` | string | Head the plan was made on. |
| `draftRevisionId` | string | Draft the plan was made on. |
| `fingerprint` | string, or `null` when not `planned` | §9. |
| `counts` | PlanCounts, or `null` when not `planned` | §5.1. |
| `coverage` | TableCoverage[] | §5.1; empty when not `planned`. |
| `refusedTables` | `{ tableId: string; code: 'headSchemaInconsistent' \| 'unledgeredTable' }[]` | Every refused table of the branch (§6.10); empty for exactly `{ all: true }`. Their units are not computed or counted. |
| `required` | RequiredUnit[] | Every required addition with its reason; empty when not `planned`. |
| `blockers` | PlanBlocker[] | Every blocker, including `migrationInProgress`; when not `planned`, the `tooLarge` blockers and `migrationInProgress` when an async migration is active. |
| `deferred` | DeferredRow[] | Commit only; empty when not `planned`. |
| `sample` | DescribedUnitRef[] | The first `min(20, counts.selected + counts.required)` applied units in listing order (display only; `listChanges` is the complete list); empty when not `planned`. |
| `unmatched` | UnmatchedSelectors, or `null` when not `planned` | §4.5; an empty object when every selector matched. |
| `estimate` | PlanEstimate | §5.1, §6.5; limits in §11. When not `planned`, what was measured up to the stop. |

A plan stopped by a limit returns no value of the plan, whichever limit stopped it: the changed-row guard stops it
before the selection is resolved, a closure estimate after (§6.5), and in both cases `fingerprint`, `counts` and
`unmatched` are `null` and the lists are empty, because what the closure found before the stop is not the plan.
Before v2.0 such a preview returned `fingerprint: ''`, zero counts and `unmatched: {}`, which read as "every selector
matched".

### 5.4 `commitChanges`

Input:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `branch` | ChangesBranch | yes | |
| `selection` | Selection | yes | §4. |
| `includeRequired` | boolean | no | Apply required additions; requires `expected`. |
| `expected` | string | engine: no; public API and MCP: yes unless the selection is exactly `{ all: true }` | Fingerprint of a commit preview of the same selection. |
| `comment` | string | no, default `''` | Stored on the new Head revision. |

Output by status:

| Status | Fields |
| --- | --- |
| `applied` | `previousHeadRevisionId`; `headRevisionId` (the former Draft revision, now Head); `draftRevisionId` (new Draft); `applied: PlanCounts` (the units applied); `draftHasChanges` (the new Draft's `hasChanges`, which the writer recomputes from the table versions, §6.13 step 7: `false` when the commit took every difference, `true` while a unit, a refused table or a content-equal version of an unread table remains, §3.8); `renumberedMigrations: { from: string; to: string }[]` (the pending migrations the commit renumbered, §6.8; empty when none). |
| `required` | `required`. |
| `blocked` | `planned` (as in a preview), `blockers`, `required`, `unmatched` (an empty object when every selector matched); when a limit stopped the plan (`planned: false`), `required` is empty and `unmatched` absent, as in §5.3. |
| `stale` | `changed`, `headRevisionId`, `draftRevisionId` (current), `unmatched` (§9.2). |
| `empty` | `headRevisionId`, `draftRevisionId` (current), `unmatched` (when some selectors did not match). |

### 5.5 `revertChanges`

Input: as `commitChanges` without `comment`; `expected` is the fingerprint of a revert preview.

Output: as `commitChanges`, except that `applied` returns `headRevisionId` (unchanged Head) and `draftRevisionId` (the
same Draft revision), with `draftHasChanges` recomputed by §6.14 step 7, and no `previousHeadRevisionId` and no
`renumberedMigrations`.

### 5.6 Statuses

Decided in this order; preview skips step 3 and returns `ready` in step 6:

1. A limit refused the plan (`tooLarge`) → `blocked`, whatever `expected` is.
2. No applied unit and no blocker → `empty`.
3. `expected` is given and differs from the fingerprint → `stale`.
4. Any blocker or unmatched selector → `blocked`.
5. Required additions exist and `includeRequired` is not set → `required`.
6. Otherwise → `applied` (commit, revert) or `ready` (preview).

| Status | Meaning | Written |
| --- | --- | --- |
| `ready` | The selection can be applied as is (or with its required additions when `includeRequired`). | nothing |
| `required` | Required additions must be added or accepted. | nothing |
| `blocked` | Not applicable; see `blockers`. | nothing |
| `stale` | The state changed since the preview; `changed` says what (§9.2). | nothing |
| `empty` | Nothing to apply (also a repeat of an applied commit). | nothing |
| `applied` | Commit or revert written. | §6.13, §6.14 |

### 5.7 Required reasons

| Code | Source | Meaning | Unit to add |
| --- | --- | --- | --- |
| `wholeRowUnit` | selection | A field of a created, deleted or replaced row was selected. | The row's existence unit. |
| `atomicValue` | selection | A pointer inside an array or file value. | The field unit of the whole value. |
| `structureBoundData` | selection, closure | A value of a new or changed field; a row of a created or removed table; the views of a table with a structure unit (§3.6); a reference at a changed field that would dangle. | The table's structure unit. |
| `referencedRowMissing` | closure | A target row references a row that exists only on the other side; or an unchanged row references an id the target loses and another unit provides. | The unit that brings the row (creation, replace, rename). |
| `referrerStillReferences` | closure | A target row or schema still references a row or table the operation removes from the target; or a pending migration that stays out of the applied units references a table id that a resulting ledger does not hold at its step (§6.6). | The referrer's other-side value (field or row unit) or its structure unit. |
| `idOccupied` | closure | Two rows, or two tables, would hold one id in the target; or a pending migration takes a table id that a resulting ledger already holds at its step (§6.6). | The unit that moves the occupant (rename, deletion, structure); for a ledger step, the unit that vacated the id or the unit of the step. |
| `referencedTableMissing` | closure | A target schema references a table that exists only on the other side; or an applied pending migration references a table id that only another unit's pending migration provides at its step (§6.6). | That table's structure unit; for a ledger step, the unit that provides the id. |

Each code arises at fixed kinds of site (§5.1), with `references` set for reference sites and the roles of its cause:

| Code | `site.kind` | `references` | `cause.role` |
| --- | --- | --- | --- |
| `wholeRowUnit`, `atomicValue` | `selector` | — | no cause |
| `structureBoundData` (selection) | `selector` | — | no cause |
| `structureBoundData` (closure) | `row` | the referenced row | `referrer` (an applied unit brings the referring value of a changed field), `remover` (an applied unit takes away the referenced row) |
| `referencedRowMissing` | `row` | the referenced row | `referrer` (an applied value, row or structure references the row), `remover` (an applied unit takes away the id that an unchanged or kept referrer references) |
| `referrerStillReferences` | `row`, `schema`, `migration` | the row or table the reference needs | `remover`; `referrer` at a `row` site when an applied structure brings the referring value of a field it changed |
| `referencedTableMissing` | `schema`, `migration` | the table | `referrer` |
| `idOccupied` | `rowId`, `tableId` | — | `taker`; `occupant` only at a pending migration's step whose unit is required |

**The unit that causes a requirement** (`cause.unit`) is the applied unit whose application needs the unit to add:

- `structureBoundData` from the closure, `referencedRowMissing` and `referrerStillReferences` of rows: the applied unit
  that brings the referring value into the target (its field unit, the row's existence unit, or the structure that
  brings the table's rows), else the applied unit that removes the referenced row from it (a deletion, a reverted
  creation, a rename). An unchanged referrer of a lost id names the unit that loses the id.
- `referrerStillReferences` and `referencedTableMissing` of schemas: the applied structure unit of the table that the
  reference meant, or of the referrer whose schema the target takes.
- `idOccupied`: the applied unit that moves the other row or table into the id: its rename or existence unit, or its
  structure unit.
- A pending migration's step (§6.6): when the provider is required, the applied structure unit of the step
  (`referrer` or `taker`). When the step's unit is required, the applied unit that changed the id before that step
  (for a taken id, by placing it or keeping it there: `occupant`; for a referenced id, by removing it, renaming it
  away or placing another table at it: `remover`), found in two steps: (1) the unit of the resulting ledger's last change of the id before the step,
  when that migration belongs to an applied unit (a commit publishes it); otherwise (2) the unit of the Draft
  ledger's last change of the id before the step, when it is an applied unit (a revert takes that migration out, so
  the resulting ledger falls back to an earlier holder). No cause when neither is an applied unit. For example, the Draft creates table `x`, renames it to `y`, and creates another table `x`;
  committing the second table alone requires the first one's unit (its `init` of `x` cannot replay after the
  published `init` of the second), and the cause is the committed table, which holds `x` at that step (`occupant`).
  Head has `notes`; the Draft creates `links` with a foreign key to `notes`, drops the key, then removes `notes`;
  committing the removal alone requires `links` (`referrerStillReferences`), and the cause is the removal
  (`remover`, step 1). Reverting a table removal whose id a pending rename of another table took requires reverting
  that rename, and the cause is the reverted removal (`occupant`, step 2).

**The role of the cause** (`CauseRole`) says what applying `cause.unit` does to the target that makes the unit to add
necessary:

| Role | Applying the cause | The unit to add |
| --- | --- | --- |
| `referrer` | brings into the target, or keeps there, a reference: a row value (its field or existence unit, or the structure that brings the table's rows), a schema, or a pending migration that references a table id | brings what the reference needs (a row, a table, the provider of a table id), or the structure that owns the referring value, or (`referrerStillReferences`) the referrer's own unit that takes the reference out |
| `remover` | takes out of the target what a reference still needs: a row or its id (a deletion, a reverted creation, a rename), a table (its removal, reverted creation or rename), or the table id that a pending migration references at its step (by removing it, renaming it away or placing another table at it) | brings it back, takes the reference out, or moves the structure that owns the referring value with it |
| `taker` | moves a row or table into an id, or applies a pending migration that takes a table id, that the row, table or migration of the unit to add holds | moves its own row or table out of the id, or vacates the id at that step |
| `occupant` | keeps a table id held at the step where a pending migration of the unit to add takes it (it restores or keeps the table that holds it) | takes its migration out of that resulting ledger |

For example, reverting the field `pets/pet2/owner`, which a native rename of `owners/o2` to `o2x` rewrote, requires
the rename: `referencedRowMissing`, site `{ kind: 'row', tableId: 'pets', rowId: 'pet2', path: '/owner' }`,
`references` `{ kind: 'row', tableId: 'owners', rowId: 'o2' }` (the id the reverted field holds), cause the field (`referrer`). Reverting the rename
alone requires the rewritten fields (`referrerStillReferences`, cause the rename, `remover`). Committing the rename
`b → a` of a swap requires the rename `a → b`: `idOccupied`, site `{ kind: 'rowId', tableId, rowId: 'a' }`, cause the
rename `b → a` (`taker`). Reverting a table removal whose id a pending rename of another table took requires reverting
that rename: `idOccupied`, site `{ kind: 'tableId', tableId, migrationId }`, cause the removal (`occupant`).

### 5.8 Blockers

| Code | Meaning | Caller action |
| --- | --- | --- |
| `requiredExcluded` | A required unit is excluded; `unit` and `reason` name it and why it is required. | Drop the exclusion or the unit that needs it. |
| `notSelectable` | A field selector addresses a computed value. | Select its inputs. |
| `danglingInSource` | No unit can restore consistency: the source is inconsistent (for example a native rename rewrote at most 100 referrers), a selected deletion is still referenced by an unchanged row, or a required unit is already applied and the problem remains. | Change the selection or repair the Draft natively. |
| `invalidRow` | An assembled row fails its target schema. | Change the selection. |
| `invalidViews` | A Draft views document that a commit publishes is invalid for its Draft structure (§6.9 step 5). | Fix the views natively. |
| `ledgerInconsistent` | A resulting ledger does not replay to its schemas (a mismatch the operation introduces); a published migration is missing or changed in the Draft ledger; a pending migration cannot be attributed to a table (§10.1); or a Draft schema history does not extend its Head history. | Change the selection, or repair the Draft natively. |
| `unrecordedStructureChange` | The Draft structure is not reproduced by its schema history and migrations (an async migration on a schema row the Draft already owned, until stage 0): its commit is refused, and Head rows cannot be migrated into it. Reverting it is allowed. | Commit other units; revert the structure. |
| `headSchemaInconsistent` | Head schema check (§6.10): a selector or a required addition involves a table whose Head schema does not match the schema replayed from the Head ledger (left by a completed native async migration, published or not). `tableId` is set. Raised by every partial operation on that table, with no exception (`all: true` with `exclude` names every table). Not raised for exactly `{ all: true }`. | Commit or revert natively or with exactly `{ all: true }`; to make the table eligible again, run the forward-only repair (§12) and publish it with a native or exactly `{ all: true }` commit. Units of other tables are unaffected. |
| `unledgeredTable` | A selector or a required addition involves an unledgered table (§6.10): its id has no intact ledger lineage, in the Head ledger for a Head table (including a revision without a migration table) or in the Draft ledger for a table created in the Draft. `tableId` is set. Not raised for exactly `{ all: true }`. | Commit or revert natively or with exactly `{ all: true }`; for a branch without a migration table, run `backfillSchemaLedger` ([schema-ledger-backfill-v1](schema-ledger-backfill-v1.spec.md)). |
| `migrationInProgress` | Preview only: an async migration is active on the branch. | Wait for it. |
| `unmatchedSelector` | Some selectors match no unit. | Fix the selection. |
| `tooLarge` | A limit (§11) is exceeded; `tableId` is set for a per-table limit. | Select less. |

When unique constraints ([ADR-0029]) are implemented, a uniqueness blocker is
added (§6.9).

### 5.9 Errors

| Condition | Result |
| --- | --- |
| `includeRequired: true` without `expected` | Validation error before any transaction. |
| `includeRequired` other than a boolean, `expected` other than a non-empty string, or `comment` other than a string (`null` in any of them is absent, §5) | Validation error before any transaction. |
| `expected` that is malformed: no `pcf<n>.` prefix with a base64url body, or a `pcf2.` payload that is not a five-element array of strings (§9.1) | Validation error before any transaction. |
| A malformed selection: an unknown field (also the pre-v2.0 `tables` and `renames`), a wrong type (`null` in an optional field is absent, §5), an empty id, a `path` that is not a JSON Pointer (RFC 6901, including invalid `~` escapes), `side` other than `'head'`, `all` or `exclude` inside `exclude` | Validation error before any transaction. (A well-formed selector that matches nothing is `unmatched`, §4.5.) |
| Invalid `pageSize` or `cursor`, or a `tableId` that names no Head or Draft table, in `listChanges` | Validation error. |
| Unknown project or branch | Not-found error (native). |
| Commit or revert while an async migration is active on the branch | `MigrationLocked` error (native lock). |
| Operation or statement timeout, attempts exhausted, any write failure | Error; the transaction is rolled back; nothing is persisted, including file references and ledger rows. A retry is safe (§9). |

### 5.10 Facade and transports

- The engine facade exposes the operations in a `changes` namespace (as the archived v1 contract did), so the flat
  native `createRevision` and `revertChanges` keep their signatures (REQ-001.BR-005): `changes.list`,
  `changes.preview`, `changes.commit` and `changes.revert` of this specification, and `changes.tableChanges`,
  `changes.rowChanges` and `changes.summary` of [draft-reads-v1](draft-reads-v1.spec.md).
- Public API, CLI and MCP map the same fields one to one (REQ-001.BR-001). The public API and MCP reject a partial
  `commitChanges` or `revertChanges` without `expected`; only the exact selection `{ all: true }` may omit it. The
  engine operations keep `expected` optional for internal callers.
- Paths are JSON Pointers at every boundary; native dot paths stay internal to the patch APIs.
- **Typed transports.** A transport gives every engine value its own type: selections and returned selectors
  (`Selection` as input, `SelectionItems` as output), `unmatched`, `estimate`, `renumberedMigrations`, reasons, sites,
  coverage and the Draft read items. Untyped JSON is used only for values that are arbitrary by nature: row data and
  field or column values, schemas and patch values, `meta`. An engine union (units by `kind`, results by `status`, a
  preview by `planned`, `site` by `kind`, the selection states of the Draft reads) maps either to a union or interface
  whose variant fields are required where the engine type has them, or to one type with the discriminator and
  optional variant fields, documented as present exactly when the engine type has them (GraphQL rejects one field
  name with different nullability across the members of a union, so a union needs distinct names). GraphQL clients
  that send a returned selector back drop `__typename` first.
- **One spelling per transport.** Every code union of the operations (§5.11) has one runtime list in the engine, next
  to its type, and the type is derived from the list. A transport builds its enums from these lists instead of
  copying the values, by one naming rule, so a code the engine adds reaches it without a hand-kept mirror and each
  value has one spelling in that transport (in GraphQL `side: HEAD` in a selector and in a unit alike):

| List | Values of |
| --- | --- |
| `CHANGE_OPERATIONS` | `PreviewChangesInput.operation` |
| `UNIT_KINDS` | `UnitKind` (§3.4) |
| `ROW_COLUMNS` | `Unit.columns` |
| `SELECTOR_SIDES` | `SelectorSide` (`side`) |
| `STRUCTURE_TABLE_CHANGES` | `StructureChange.table` (§5.2) |
| `STRUCTURE_FIELD_CHANGES` | `ChangedField.change` (§5.2) |
| `ANNOTATION_KEYWORDS` | `ChangedField.annotations` (§5.2) |
| `REQUIRED_REASON_CODES` | `RequiredReasonCode` (§5.7) |
| `REASON_SITE_KINDS` | `ReasonSite.kind` (§5.1) |
| `CAUSE_ROLES` | `ReasonCause.role` (§5.7) |
| `BLOCKER_CODES` | `BlockerCode` (§5.8) |
| `REFUSAL_CODES` | `RefusedTable.code` (§6.10) |
| `PREVIEW_STATUSES` | `PreviewChangesResult.status` (§5.6) |
| `APPLY_STATUSES` | `CommitChangesResult.status`, `RevertChangesResult.status` (§5.6) |
| `STALE_CHANGES` | `ChangesStale.changed` (§9.2) |

**Transport contract (delivery stage 4).** Names are proposals; they avoid the native `revertChanges`.

| Engine facade | GraphQL | MCP tool | Permission ([permission-system-v1]) | Audit action ([audit-logs-v1]) |
| --- | --- | --- | --- | --- |
| `changes.list` | query `draftChanges` | `list_draft_changes` | `read` on Revision (`canReadRevision`) | none |
| `changes.preview` | query `previewDraftChanges` | `preview_draft_changes` | same as `changes.list` | none |
| `changes.commit` | mutation `commitDraftChanges` | `commit_draft_changes` | `create-revision` (create, Revision) | `revision.commit_changes` (new) |
| `changes.revert` | mutation `revertDraftChanges` | `revert_draft_changes` | `revert-revision` (revert, Revision) | `revision.revert_changes` (new) |
| `changes.tableChanges` | query `draftTableChanges` | `list_draft_table_changes` | same as `changes.list` | none |
| `changes.rowChanges` | query `draftRowChanges` | `list_draft_row_changes` | same as `changes.list` | none |
| `changes.summary` | query `draftChangesSummary` | `get_draft_changes_summary` | same as `changes.list` | none |

- The engine has no permission or audit layer; the host application enforces the permissions and writes the audit
  records, as it does for native `createRevision` and `revertChanges`. The reads and the preview show uncommitted
  Draft content and the preview is the most expensive read; a host may require an authenticated caller with a
  Draft-level permission for them and limit concurrent previews per branch (recommended by the architecture review of
  2026-11-10; decided with the host).
- REST exposes the seven operations under the branch's Draft (`…/draft/changes`, `…/draft/changes/preview`,
  `…/draft/changes/commit`, `…/draft/changes/revert`, `…/draft/changes/tables`, `…/draft/changes/rows`,
  `…/draft/changes/summary`), following the existing REST prefix conventions.
- Audit records are written for `applied` results only, with the operation's outcome as metadata: `all: true` or
  partial, `includeRequired`, the applied counts, `draftHasChanges`, `renumberedMigrations`, previous and new Head ids
  (commit) or the Draft id (revert). The selection itself is not stored, only its counts.
- Endpoint effects ([endpoint-v1]): endpoints are bound to a revision id and resolve `head` and
  `draft` by revision. Native `createRevision` notifies nothing, because no revision id changes content; native
  `revertChanges` notifies for the Draft after its transaction. A partial commit changes what revision X contains
  (from Draft content to the assembled Head) and creates a new Draft, so after the transaction it notifies for X and
  for the new Draft (§6.13); a partial revert notifies for the Draft after the transaction (§6.14). Both use the
  engine's `notifyEndpoints` hook, which is a no-op in the engine package and implemented by the host.

**Exported names.** The package exports the types of §5.11 and of draft-reads-v1 §9 under these names. Names that
would clash with native diff payloads or read as generic nouns are qualified: the structure classifications are
`StructureTableChange` and `StructureFieldChange` (native `TableChange`, `RowChange` and `FieldChange` are the native
diff payloads, and no type of this API reuses those names), the plan's blocker, counts and estimate are `PlanBlocker`,
`PlanCounts` and `PlanEstimate`, a deferred row is `DeferredRow`, a reason `RequiredReason`, and the selection-state
variants of the Draft reads end in `Selection` (`GoesWithSelection`, `FieldUnitSelection`, …).

### 5.11 TypeScript types

```ts
type ChangesBranch = { projectId: string; branchName: string };
type SelectorSide = 'head';

type TableRef = { tableId: string; side?: SelectorSide };
type RowRef = { tableId: string; rowId: string; side?: SelectorSide };
type FieldRef = { tableId: string; rowId: string; path: string };   // JSON Pointer
type SelectionItems = {
  structures?: TableRef[];        // structure units
  tableData?: string[];           // row and field units of a table
  views?: string[];
  sharedSchemas?: string[];
  rows?: RowRef[];                // every unit of a row
  rowRenames?: RowRef[];          // the rowRename unit only
  rowColumns?: RowRef[];          // the rowColumns unit only
  fields?: FieldRef[];
};
type Selection = SelectionItems & { all?: boolean; exclude?: SelectionItems };
type UnmatchedSelectors = SelectionItems & { exclude?: SelectionItems };

type UnitKind = 'field' | 'rowCreate' | 'rowDelete' | 'rowReplace' | 'rowRename' | 'rowColumns'
  | 'structure' | 'views' | 'sharedSchema';
type RowColumn = 'publishedAt' | 'meta' | 'schemaHash';
type Unit =
  | { kind: 'field'; tableId: string; rowId: string; path: string }
  | { kind: 'rowCreate' | 'rowDelete' | 'rowReplace'; tableId: string; rowId: string }
  | { kind: 'rowRename'; tableId: string; rowId: string; previousRowId: string }
  | { kind: 'rowColumns'; tableId: string; rowId: string; columns: RowColumn[] }
  | { kind: 'structure'; tableId: string; previousTableId?: string }
  | { kind: 'views'; tableId: string }
  | { kind: 'sharedSchema'; sharedSchemaId: string };
type UnitRef = Unit & { side?: SelectorSide; selector: SelectionItems };  // resolves to exactly this unit
type StructureTableChange = 'created' | 'removed' | 'replaced' | 'transient' | 'changed';
type StructureFieldChange = 'added' | 'removed' | 'changed' | 'moved' | 'annotated';
type AnnotationKeyword = 'contentMediaType' | 'default' | 'deprecated' | 'description' | 'readOnly' | 'title';
type ChangedField = { path: string; change: StructureFieldChange; from?: string;
  annotations?: AnnotationKeyword[] };                                 // annotated entries only
type StructureChange = { table: StructureTableChange; fields: ChangedField[]; views: boolean };
type DescribedUnitRef = UnitRef & { structureChange?: StructureChange }; // structure units only
type ListedUnit = DescribedUnitRef & { structure?: UnitRef };

type ReasonSite =
  | { kind: 'selector'; tableId: string; rowId?: string; path?: string }
  | { kind: 'row'; tableId: string; rowId: string; path: string }
  | { kind: 'schema'; tableId: string }
  | { kind: 'migration'; tableId: string; migrationId: string }
  | { kind: 'rowId'; tableId: string; rowId: string }
  | { kind: 'tableId'; tableId: string; migrationId?: string };
type ReferencedEntity = { kind: 'row'; tableId: string; rowId: string } | { kind: 'table'; tableId: string };
type CauseRole = 'referrer' | 'remover' | 'taker' | 'occupant';
type ReasonCause = { unit: DescribedUnitRef; role: CauseRole };
type RequiredReason = { code: RequiredReasonCode; because: string; site: ReasonSite;
  references?: ReferencedEntity; cause?: ReasonCause };
type RequiredUnit = { unit: DescribedUnitRef; reason: RequiredReason };
type PlanBlocker = { code: BlockerCode; tableId?: string; rowId?: string; path?: string; message: string;
  unit?: DescribedUnitRef; reason?: RequiredReason };
type DeferredValue = { path: string; value: unknown };
type DeferredPath = { path: string };
type DeferredRow = { unit: DescribedUnitRef; defaulted: DeferredValue[]; omitted: DeferredPath[];
  structure: DescribedUnitRef };
type PlanEstimate = { changedRows: number; mergedRows: number; perRowWorkRows: number;
  mixedTables: Array<{ tableId: string; linksCopied: number; linksAdded: number }> };
type PlanCounts = { selected: number; required: number };
type TableCoverage = { tableId: string; previousTableId?: string; side?: SelectorSide; structure?: boolean;
  views?: boolean; rows: number; appliedRows: number; partlyAppliedRows: number };
type RefusedTable = { tableId: string; code: RefusalCode };
type RefusalCode = 'headSchemaInconsistent' | 'unledgeredTable';

type ListChangesInput = { branch: ChangesBranch; tableId?: string | null; cursor?: string | null;
  pageSize?: number | null };
type ListChangesResult = { headRevisionId: string; draftRevisionId: string; units: ListedUnit[];
  nextCursor: string | null; refusedTables: RefusedTable[] };

type ChangeOperation = 'commit' | 'revert';
type PreviewChangesInput = { branch: ChangesBranch; operation: ChangeOperation; selection: SelectionInput;
  includeRequired?: boolean | null };
type PreviewBase = { headRevisionId: string; draftRevisionId: string; refusedTables: RefusedTable[];
  blockers: PlanBlocker[]; estimate: PlanEstimate };
type PlannedPreview = PreviewBase & { status: 'ready' | 'required' | 'blocked' | 'empty'; planned: true;
  fingerprint: string; counts: PlanCounts; coverage: TableCoverage[]; required: RequiredUnit[];
  deferred: DeferredRow[]; sample: DescribedUnitRef[]; unmatched: UnmatchedSelectors };
type StoppedPreview = PreviewBase & { status: 'blocked'; planned: false; fingerprint: null; counts: null;
  coverage: []; required: []; deferred: []; sample: []; unmatched: null };
type PreviewChangesResult = PlannedPreview | StoppedPreview;

type CommitChangesInput = { branch: ChangesBranch; selection: SelectionInput; includeRequired?: boolean | null;
  expected?: string | null; comment?: string | null };
type RevertChangesInput = Omit<CommitChangesInput, 'comment'>;
type MigrationRenumbering = { from: string; to: string };
type StaleChange = 'version' | 'operation' | 'revisions' | 'units' | 'content';
type ChangesRequireAdditions = { status: 'required'; required: RequiredUnit[] };
type ChangesBlocked =
  | { status: 'blocked'; planned: true; blockers: PlanBlocker[]; required: RequiredUnit[];
      unmatched: UnmatchedSelectors }
  | { status: 'blocked'; planned: false; blockers: PlanBlocker[]; required: [] };  // stopped by a limit
type ChangesStale = { status: 'stale'; changed: StaleChange[]; headRevisionId: string; draftRevisionId: string;
  unmatched: UnmatchedSelectors };
type NothingToApply = { status: 'empty'; headRevisionId: string; draftRevisionId: string;
  unmatched?: UnmatchedSelectors };
type CommittedDraft = { status: 'applied'; previousHeadRevisionId: string; headRevisionId: string;
  draftRevisionId: string; applied: PlanCounts; draftHasChanges: boolean;
  renumberedMigrations: MigrationRenumbering[] };
type RevertedDraft = { status: 'applied'; headRevisionId: string; draftRevisionId: string; applied: PlanCounts;
  draftHasChanges: boolean };
type UnappliedChanges = ChangesRequireAdditions | ChangesBlocked | ChangesStale | NothingToApply;
type CommitChangesResult = CommittedDraft | UnappliedChanges;
type RevertChangesResult = RevertedDraft | UnappliedChanges;
```

`RequiredReasonCode` and `BlockerCode` are the codes of §5.7 and §5.8. `SelectionInput` is `Selection` with `| null`
added to each optional field at every depth; the engine normalises it into `Selection` (§5).

### 5.12 Examples

**Preview `required`, then commit with the reviewed additions.** Row `p1` of `products` points to a category `c9`
created in the Draft.

```json
{ "branch": { "projectId": "proj-1", "branchName": "master" }, "operation": "commit",
  "selection": { "fields": [{ "tableId": "products", "rowId": "p1", "path": "/category" }] } }
```

```json
{ "status": "required", "planned": true, "headRevisionId": "rev-h1", "draftRevisionId": "rev-d1",
  "fingerprint": "pcf2.…", "counts": { "selected": 1, "required": 1 },
  "coverage": [
    { "tableId": "categories", "rows": 1, "appliedRows": 1, "partlyAppliedRows": 0 },
    { "tableId": "products", "rows": 3, "appliedRows": 0, "partlyAppliedRows": 1 }],
  "required": [{
    "unit": { "kind": "rowCreate", "tableId": "categories", "rowId": "c9",
              "selector": { "rows": [{ "tableId": "categories", "rowId": "c9" }] } },
    "reason": { "code": "referencedRowMissing",
                "site": { "kind": "row", "tableId": "products", "rowId": "p1", "path": "/category" },
                "references": { "kind": "row", "tableId": "categories", "rowId": "c9" },
                "cause": { "role": "referrer",
                           "unit": { "kind": "field", "tableId": "products", "rowId": "p1", "path": "/category",
                                     "selector": { "fields": [
                                       { "tableId": "products", "rowId": "p1", "path": "/category" }] } } },
                "because": "products/p1/category references categories/c9, which exists only in the Draft" } }],
  "blockers": [], "deferred": [], "unmatched": {}, "refusedTables": [],
  "sample": [
    { "kind": "rowCreate", "tableId": "categories", "rowId": "c9",
      "selector": { "rows": [{ "tableId": "categories", "rowId": "c9" }] } },
    { "kind": "field", "tableId": "products", "rowId": "p1", "path": "/category",
      "selector": { "fields": [{ "tableId": "products", "rowId": "p1", "path": "/category" }] } }],
  "estimate": { "changedRows": 4, "mergedRows": 0, "perRowWorkRows": 0, "mixedTables": [] } }
```

The caller commits the same selection with `"includeRequired": true, "expected": "pcf2.…"`, or adds the listed
`selector` to its selection, and gets `"status": "applied"` with `"applied": { "selected": 1, "required": 1 }`.

**`blocked`: a required unit is excluded.**

```json
{ "status": "blocked",
  "blockers": [{ "code": "requiredExcluded", "tableId": "categories", "rowId": "c9",
    "message": "categories/c9 is required but excluded",
    "unit": { "kind": "rowCreate", "tableId": "categories", "rowId": "c9",
              "selector": { "rows": [{ "tableId": "categories", "rowId": "c9" }] } },
    "reason": { "code": "referencedRowMissing",
                "site": { "kind": "row", "tableId": "products", "rowId": "p1", "path": "/category" },
                "references": { "kind": "row", "tableId": "categories", "rowId": "c9" },
                "cause": { "role": "referrer", "unit": { "kind": "field", "tableId": "products", "rowId": "p1",
                  "path": "/category", "selector": { "fields": [
                    { "tableId": "products", "rowId": "p1", "path": "/category" }] } } },
                "because": "products/p1/category references categories/c9, which exists only in the Draft" } }],
  "required": [] }
```

**`stale`: a selected field was edited again after the preview.**

```json
{ "status": "stale", "changed": ["content"], "headRevisionId": "rev-h1", "draftRevisionId": "rev-d1",
  "unmatched": {} }
```

**A preview stopped by a limit.** The affected tables have more changed rows than `maxChangedRows`.

```json
{ "status": "blocked", "planned": false, "headRevisionId": "rev-h1", "draftRevisionId": "rev-d1",
  "fingerprint": null, "counts": null, "coverage": [], "unmatched": null, "required": [], "deferred": [],
  "sample": [], "refusedTables": [],
  "blockers": [{ "code": "tooLarge", "message": "…" }],
  "estimate": { "changedRows": 120000, "mergedRows": 0, "perRowWorkRows": 0, "mixedTables": [] } }
```

**Commit of a structure unit with renumbering.** The Draft holds migration `2026-10-20T10:00:00.000Z` for
`products` and a later one, `2026-10-21T09:00:00.000Z`, for `orders`; only `orders` is committed, at
`2026-10-22T14:03:12.418Z`. The remaining `products` migration gets a new id by the native rule (the latest of the
current time, the last published `publishedAt` + 1 ms and the last published id + 1 ms), here the commit time.

```json
{ "status": "applied", "previousHeadRevisionId": "rev-h1", "headRevisionId": "rev-d1",
  "draftRevisionId": "rev-d2", "applied": { "selected": 1, "required": 0 }, "draftHasChanges": true,
  "renumberedMigrations": [{ "from": "2026-10-20T10:00:00.000Z", "to": "2026-10-22T14:03:12.418Z" }] }
```

## 6. Algorithm

### 6.1 Flow

| Operation | Actions |
| --- | --- |
| `listChanges` | ValidateInput → OpenPlanningTransaction → ReadTablePairs → per table from the cursor (§5.2): ReadChangedRows → BuildCatalogue → ListUnits, until the page is full → BuildSelectors |
| `previewChanges` | OpenPlanningTransaction → ReadMigrationLock (as a blocker) → Plan → Decide |
| `commitChanges` | ValidateInput → (attempt loop, §8.1: OpenSerializableTransaction → CheckMigrationLock → Plan → Decide → WriteCommit → Commit) → NotifyAfterCommit |
| `revertChanges` | ValidateInput → (attempt loop, §8.1: OpenSerializableTransaction → CheckMigrationLock → Plan → Decide → WriteRevert → Commit) → NotifyAfterCommit |

Plan = ReadScope → GuardChangedRows → BuildCatalogue → ResolveSelection → CloseDependencies (EstimateAndGuard before
every AssembleTarget) → PlanLedger → ValidateTarget → CheckHeadSchema → ComputeFingerprint.

### 6.2 ReadScope and GuardChangedRows

1. Resolve the branch, its Head and its Draft revision.
2. Read the table versions of both revisions and pair them by identity (all tables).
3. Read the four system tables of both sides in full; attach schemas; for every table on both sides compute the
   pending history (the Draft history minus its Head prefix), whether it is **recorded** (Head schema plus pending
   history equals the Draft schema) and the unchanged and changed leaves (§3.3). A damaged table (§6.10), which only
   exactly `{ all: true }` can reach, counts as recorded when either baseline followed by the pending migrations
   equals the Draft schema: the Head schema row (what native sees, so existing damage is published as native would
   publish it) or the schema replayed from the Head ledger (a repaired Draft). Otherwise →
   `unrecordedStructureChange`.
4. Determine the affected tables:
   - `all: true` → every table;
   - otherwise start with the user tables named by any selector, included or excluded (`structures`, `tableData`,
     `views`, `rows`, `rowRenames`, `rowColumns`, `fields`), matched by Head or Draft public id or by an id their pending
     migrations gave them (a table created and removed in the Draft is named by its ids alone); then add, transitively,
     every user table that shares such an id with an affected table (renames, reused and taken-over ids) and every
     user table connected to an affected table by a foreign key, in either direction: a foreign key in its Head or
     Draft schema, or a foreign-key target named by a pending migration of either table (an `init` schema or an
     `update` patch value), matched by the ids the target held through its pending renames;
   - the system tables are always read whole (step 3); `sharedSchemas` selects system rows only.

   This is enough because every required addition comes from the table itself, a table sharing an id or a table
   connected by a foreign key, including a table that a pending migration needs at its step (§6.6): the plan equals
   the plan that reads every table (AS-74). The planner checks it before deciding: a plan that applies a unit of a
   changed table it did not read is an internal error and is never written.
5. Count the changed rows of the affected tables in SQL with the change predicate (§3.1). Rows of created or removed
   tables are not counted (they are linked whole). An affected table counts in full, even for a one-row selection
   (an accepted v1 limit). Above `maxChangedRows` → refuse with `tooLarge` and stop.
6. Load the changed row pairs of the affected tables (all columns of both versions). Unread tables (§1) are not read:
   their row units are neither counted nor applied, and their links do not change.

### 6.3 BuildCatalogue

1. Split the migration ledger into published (Head) and pending (Draft rows that Head does not link) entries and
   attribute every pending entry to a table identity (§10.1).
2. Pair the schema and views rows of every table. A table on both sides without a structure unit has a views unit
   when its Draft views document differs from its Head document (§3.6); no views document is migrated through the
   pending history.
3. Create the units of §3.4 (table-level units for every table, row units for the affected tables), transient groups
   and shared schemas; record the system rows each unit owns (schema, views and pending migration rows) and, per
   changed row, the owning unit of each differing column (§3.1).

### 6.4 ResolveSelection

Apply §4 and produce: selected units, excluded units, required additions from normalisation with reasons, blockers
(`notSelectable`, `requiredExcluded`) and unmatched selectors.

### 6.5 EstimateAndGuard

Runs inside CloseDependencies before **every** AssembleTarget, for the applied set of that iteration (the closure can
add required units, so one estimate before the closure is not enough):

1. From the catalogue alone, apply the row and table outcome rules of §6.7 without merging: which rows will be
   merged or converted and which tables are mixed. The estimator and AssembleTarget use the same outcome rules.
2. Count `perRowWorkRows` (merged or converted rows in mixed tables whose target schema has formula or File fields)
   and, per mixed table, the links it will copy (one link count per mixed table, kept for the operation).
3. Above a limit (§11) → refuse with `tooLarge` before that assembly: nothing is merged and no formula is evaluated.

The result is the `estimate` (§5.1), an upper bound. A refused plan has no fingerprint (`planned: false`, §5.3) and
is `blocked` before the `expected` comparison, never `stale` (§5.6). No limit is rechecked after the closure: the last estimate
covers the final applied set.

### 6.6 CloseDependencies

```text
applied := selected ∪ required-by-normalisation
repeat:
  EstimateAndGuard(applied); refused → stop with tooLarge (§6.5)
  target := AssembleTarget(applied)                     (§6.7)
  findings := StructureChecks(target) ∪ LedgerDependencyChecks(target) ∪ RowChecks(target)
  for each finding:
    blocker                         → keep the blocker
    unit is excluded                → blocker requiredExcluded
    unit is already applied         → blocker danglingInSource
    otherwise                       → add the unit to applied and to required with the reason
until no unit was added
```

Structure checks:

- **Table id collisions** in the target → the structure unit of the table that keeps its base id (`idOccupied`).
- **Foreign keys of target schemas to missing tables** → the referrer's structure when its other-side schema no
  longer references that table (`referrerStillReferences`, which covers the referrers a rename rewrote), otherwise
  the structure unit that brings a table with that id (`referencedTableMissing`).
- **Foreign-key values of rows brought in wholesale** (created and restored tables; tables whose foreign-key leaves
  changed and come from the other side), checked in SQL as distinct values → `referencedRowMissing`.

Row checks:

- **Row id collisions** in a target table → the rename or existence unit of the row that keeps its base id
  (`idOccupied`).
- **Foreign-key values of target rows** (loaded rows of tables with foreign keys) that resolve nowhere in the
  target → the unit that brings the referenced row (`referencedRowMissing`); the referrer's other-side value
  (`referrerStillReferences`); the structure when the reference sits in a changed field (`structureBoundData`); the
  refusal code of the referenced table when it is refused (§6.10); or `danglingInSource`.
- **Unchanged referrers of ids the target loses**, found in SQL over the referrer tables → the unit that provides a
  row with that id (`referencedRowMissing`) or `danglingInSource`. A refused referrer (§6.10) has no loaded rows, so
  all its rows are read here. When no unit provides the id, only a change of the refused table could drop the
  reference, and the plan is blocked with its refusal code. When its other side references the id as well (a row
  there holds the id in a foreign key to that table under the other side's own schema), the source itself dangles and
  the blocker stays `danglingInSource`. The other side is read once per closure for each of its foreign-key leaves
  toward that table, for all ids the table can lose; an unchanged referrer shares the read of its own side.

**Ledger dependencies.** The structure checks compare the final target only. A pending migration can need, at its own
step, a table id that only another unit's pending migration provides, while the final schemas are consistent because a
native rename rewrites its referrers. After every assembly the closure replays each resulting ledger (§6.9: commit →
new Head and remaining Draft; revert → reverted Draft) and follows table ids through `init`, `rename` and `remove`. A
step of an `init` or `update` **depends** on a table id its schema references when, at that step, the id resolves to
another lineage (the slot of the identity pass, named by its opening migration) in the resulting ledger than in the
Draft ledger, or to none; a step of an `init` or `rename` depends on the id it takes when the resulting ledger already
holds that id at that step and the Draft ledger does not. The dependency counts only when validation would report the
step's lineage in that resulting ledger (§6.9): an inconsistency that the source role already has, with the same
lineage and failure, and a lineage that validation leaves out (unledgered tables) add nothing. The **provider** is the
structure unit (§10.1) of the Draft migration that last placed the referenced id (`init`, `rename` into it), or last
vacated the taken id (`rename` away, `remove`), before that step.

- The step belongs to an applied unit (it fails in the new Head) → the provider is required: `referencedTableMissing`
  for a referenced id, `idOccupied` for a taken id.
- The step belongs to a unit that is not applied (it fails in the reverted or the remaining Draft) → the unit of the
  step is required: `referrerStillReferences` for a referenced id, `idOccupied` for a taken id.

`because` names the migration and the table id. An excluded unit gives `requiredExcluded`. A step whose unit is not in
the catalogue (a published migration, a refused table), or, when the provider would be the required unit, whose
provider is not, adds nothing and is left to validation (`ledgerInconsistent`, §6.9). The cause of a requirement
follows §5.7: the provider lookup above decides which unit is required, not which applied unit caused it. A step that fails only because a table it reads failed earlier is not
a dependency of its own: the closure follows the earlier step and checks again after adding its unit. Every
requirement adds a unit, so the loop terminates; replays are cached per closure by ledger content, and a choice that
applies no unit with pending migrations leaves every ledger as in its source and is not replayed. Examples, built
natively:

1. `notes` renamed to `memos`, `links` created with a foreign key to `memos`, `memos` renamed back to `notes` (which
   rewrote `links`). Reverting `notes` requires reverting `links`: its `init` references `memos`, which the reverted
   Draft ledger does not hold. Committing `links` requires `notes`. Committing `notes` requires `links`, because the
   remaining Draft would replay the `init` of `links` after both renames.
2. `categories` renamed to `kinds`, `links` created with a foreign key to `kinds` and removed. Reverting `kinds`
   requires reverting the transient `links`; committing `links` requires `kinds`.
3. `notes` removed, then `categories` renamed to `notes`, `products` to `categories` and `notes` to `products`.
   Reverting the removal of `notes` requires reverting the table now named `products`, whose rename takes `notes`
   (`idOccupied`), and then the table now named `categories`. Committing the table now named `products` requires the
   removal of `notes`.
4. `notes` created, `products` given a foreign key to `notes`, `notes` renamed to `memos` (which rewrote `products`),
   another `notes` created. Committing both tables requires `products`: the remaining Draft would replay its `update`
   after both creations and the rename, so its reference resolves to the other `notes`.

### 6.7 AssembleTarget

Per user table on both sides, with structure side S and the opposite side O:

- A unit **takes the other side** when it is taken from the Draft and S is Head, or the reverse.
- **Row outcome** for each loaded changed row:
  1. Its existence unit (create, delete, replace) takes the other side → the O version if present, moved into S's
     structure when the structures differ; otherwise absent.
  2. Else no S version → absent; no O version → the S version.
  3. Else collect the units of the row that take the other side: field units, the rename, and the owner of every
     differing column (§3.1). None → the S version. All of them (every field, the rename and every column owner) and
     the structures do not differ → the O version. Otherwise a **merged** version (columns below); it collapses to an
     existing version when equal to it on the compared columns.
  4. Rows not loaded (§3.1) follow S.
- **Moving a row between structures:**
  - Draft row into the Head structure: Head defaults, then the Draft values of unchanged leaves, then the plugin hooks
    for migrated rows. In a commit the changed fields are reported in `deferred`.
  - Head row into the Draft structure: the pending history patches applied to the row, then the plugin hooks. If the
    Draft structure is not recorded → blocker `unrecordedStructureChange`.
- **Merged row columns.** Each column comes from the side its owning unit chose; a column without a difference is
  the same on both sides:

  | Column | Value |
  | --- | --- |
  | `data` | S data with the O values at the paths of field units that take the other side; formulas recomputed |
  | `id` | O id if the rename unit takes the other side, else S id |
  | `publishedAt` | O if its owner (field unit or `rowColumns`) takes the other side, else S (a structure-owned value follows S) |
  | `meta` | O if the `rowColumns` unit that owns it takes the other side, else S |
  | `hash` | native rule: hash of the merged data |
  | `schemaHash` | O if the `rowColumns` unit that owns it takes the other side, else the hash of the target schema |
  | `createdId`, `createdAt` | of the row (S) |
  | `readonly` | true in a commit, false in a revert |

- **Table outcome:**

  | Outcome | When | Target links |
  | --- | --- | --- |
  | unchanged | the table has no unit | the base version |
  | present / absent | created or removed table | its version if its structure unit is taken from its side, else nothing |
  | base | every row keeps S's link | the S version |
  | other | no structure unit, every unit takes the other side, every row is O or absent | the O version |
  | mixed | otherwise | a new table version (§6.13, §6.14) |

- **System tables** are assembled the same way from desired rows: schema rows from each table's structure side;
  migration rows = the target ledger (§10.2); views rows from the views target: the side of the table's structure
  unit when it has one, otherwise the side of its views unit when it has one, otherwise the base side (§3.6); shared
  schema rows from their units' sides.
- **Tables without remaining units (relink).** Only tables the operation read are considered: affected user tables and
  the system tables. Such a table whose units are all applied (for system tables: no unit of the owning kinds remains —
  schema ← structure; migrations ← structure; views ← structure or views; shared schemas ← shared schema) is a *relink
  candidate*. (A pending migration that cannot be attributed blocks the operation earlier, §10.1.) The writer links the
  Head version into the Draft (*draft follows Head*) only when the content check (§1) finds the Draft version equal to
  the Head version the Draft would link: after a commit the new Head version is compared with the Draft version; in a
  revert the assembled Draft version is written first and then compared with the Head version (§6.13, §6.14). The
  content check is a second layer behind unit completeness: a compared-column edit that change detection missed is never
  dropped by a relink.
- **Unread tables** keep their Draft version, also when only content-equal versions remain there (§3.8).
- With `all: true` and no `exclude`, every table is read and a table without units takes the other side's version, so
  Head equals the Draft versions as in native commit (and the Draft equals Head as in native revert).

### 6.8 PlanLedger

- Target ledger = published entries plus pending entries of structure units taken from the Draft, with their
  original row versions and ids.
- Commit: remaining = the other pending entries. If any remaining id is not greater than the greatest target id,
  renumber **all** remaining entries in their original order: each new id is `nextNativeMigrationId` of the
  previous bound (starting from the greatest target id and the latest target `publishedAt`); `id`, `data.id` and
  `publishedAt` change together.
- Revert: pending entries of reverted structure units leave the Draft ledger; no renumbering.

### 6.9 ValidateTarget

1. Commit only: an applied structure unit whose table is not recorded → `unrecordedStructureChange`.
2. A published migration missing or changed in the Draft ledger → `ledgerInconsistent`.
3. Replay in memory the ledger of every resulting role with the shared ledger replay of [async-row-migration-v2]
   §5.1: an identity pass that follows each table id through `init`, `rename` and `remove`, then a schema pass with the
   native rules (a foreign-key target must exist at each step; `remove` is refused while referenced; `rename` refuses a
   taken id and rewrites referrer schemas), in which a failing step taints its slot and every later step that reads a
   tainted slot taints its own. Compare the result with the role's schemas: commit → new Head and remaining Draft (with
   renumbered ids); revert → reverted Draft. A mismatch or failure that the source role does not already have →
   `ledgerInconsistent`. Inconsistencies that exist natively are tolerated, except damaged Head tables (§6.10).
   Unledgered tables (§6.10) are left out of the comparison (only exactly `{ all: true }` can apply their units).
4. Validate every merged row against its target schema → `invalidRow`.
5. Commit only: validate the Draft views document of every table whose structure or views unit the commit applies
   (its shape, view ids and fields against the table's Draft structure), with that unit as the owner →
   `invalidViews`. Views and structure always come from the same side (§3.6), so a failure is a document that does not
   fit its own side's structure (native damage), never a combination. A revert restores published Head documents and
   validates none; a table without an applied structure or views unit keeps its document unvalidated. Exactly
   `{ all: true }` is validated the same way, so its commit refuses a damaged Draft views document that native commit
   would publish, also one that Head already holds under a structure the commit changes.
6. When unique constraints exist ([ADR-0029]): validate uniqueness over the whole target table, not only the written
   rows, because Head and Draft rows that are valid on their own sides can collide when combined.

### 6.10 CheckHeadSchema

The **Head schema check**. A completed native async migration rewrites a shared schema row and views row in place and
records no migration (§8.3). The damage has two shapes, and both are refused:

- **(i) Not yet published:** the swap rewrote the schema row the Draft shares with the Head. The Head rows were never
  migrated; they keep the old shape and hash under the rewritten schema row, while the Draft links the migrated
  shadow table.
- **(ii) Published:** a later native commit published the Draft, so the Head rows now match the rewritten schema row;
  only the ledger is behind.

**Draft-only damage is not Head damage.** When the Draft had already copied the schema row, the swap rewrote only
the Draft's own row. The Head passes predicate (b) and the table is not refused; the Draft structure is not recorded,
so committing its structure unit is `blocked` (`unrecordedStructureChange`, AS-46). Reverting that structure unit is
allowed and removes the unrecorded change: the revert takes the Head structure (§6.7, rows move from the Draft into the
Head structure), and §6.9 step 1 applies to commits only.

**Predicates**, per user table and revision:

- **(b) Ledger replay — the refusal predicate.** For a ledgered table, the replay of that revision's ledger (§6.9)
  gives its slot a schema deep-equal (object key order ignored) to the schema row. A table fails it when the replayed
  schema differs, or when its slot is tainted: a step of its own lineage failed, or one of its steps read a tainted slot. A taint fails only
  the tables whose slots it reaches, not every table of the ledger.
- **(a) Row invariant — a scan diagnostic only (§12), never a refusal.** Every row of the table version has
  `schemaHash` equal to the `hash` of that revision's schema row (both are `objectHash` of the schema). Damage shape
  (i) breaks it in the Head, but it is not a native invariant: a table rename rewrites the referencing tables' schema
  rows without re-hashing their rows, and the exported low-level row API can write any `schemaHash`, including `''`
  (verified at 139eb7b, `draft/commands/handlers/transactional/rename-schema.handler.ts:55-75` →
  `update-schema.handler.ts:112-128`; `draft-revision/commands/handlers/draft-revision-create-rows.handler.ts:120`).
  These are its known false-positive sources. Table rename is not changed in stage 0: re-hashing would copy every row
  of every referencing table.
- **Views:** the ledger records nothing about views and direct views edits are not derivable from it, so a views row
  cannot be checked by replay. The swap rewrites the views row in the same step as the schema row, so a table that
  fails (b) is treated as having damaged views too; damage to views alone is not detectable.
- **Unledgered table:** a table whose id ends the identity pass of the replay (§6.9) without an open slot or with a
  broken lineage: no `init` opened a slot that leads to its id, or an unattributable `rename`, `update` or `remove`
  broke that lineage. This covers every table of a revision without a migration table (the host created the project
  without one, and native writers then skip the ledger silently). A Head table is checked against the Head ledger, a
  table created in the Draft against the Draft ledger. "Unledgered" is a property of the lineage, not of a literal
  `init` of the current id: a table created as `A` and renamed to `B` through recorded migrations is ledgered.
  Predicate (b) cannot be evaluated for an unledgered table.

**Refused tables.** A *partial operation* is anything other than exactly `{ all: true }` without `exclude`.

1. An unledgered table is refused with the code `unledgeredTable`. A branch without a migration table becomes eligible
   after [schema-ledger-backfill-v1](schema-ledger-backfill-v1.spec.md); other unledgered tables come from damage and
   stay refused.
2. A table that fails (b) in the Head (*damaged*, either shape) is refused with the code `headSchemaInconsistent`, by
   every partial operation and with no exception: data units, row units, its structure unit, commit and revert alike.
   It becomes eligible again only after the forward-only repair (§12) has been published by a native or exactly
   `{ all: true }` commit; from then on its Head ledger replays to its Head schema.
3. `listChanges` and `previewChanges` compute no units for refused tables and return them in `refusedTables`
   (`{ tableId, code }`). In preview, commit and revert, a selector that names a refused table, or a required addition
   that would have to come from one, makes the plan `blocked` with that table's code (the selector is not reported as
   unmatched). `all: true` with `exclude` names every table, so any refused table on the branch blocks it. A refused
   table is never assembled or relinked by a partial operation.
4. Exactly `{ all: true }` is exempt and keeps native equivalence (REQ-001.BR-005): it computes units for every table
   and commits or reverts a damaged or unledgered table as native `createRevision` and `revertChanges` do. For a
   damaged table, "recorded" (§6.2 step 3) accepts either baseline: the Head schema row, so an unrepaired table is
   published as native would publish it, or the schema replayed from the Head ledger, so a repaired Draft can be
   published; if neither matches, the operation is refused with `unrecordedStructureChange`. It still refuses
   inconsistency it would introduce itself (`danglingInSource`, AS-36; `unrecordedStructureChange`, AS-46;
   `ledgerInconsistent`, AS-48) and, in a commit, a Draft views document invalid for a structure or views change it
   publishes (`invalidViews`, §6.9 step 5, AS-83); otherwise it does not police damage the Head already has.

Tables that are not refused are not affected, so units of other tables still apply.

### 6.11 ComputeFingerprint

§9.1.

### 6.12 Decide

§5.6. Commit and revert stop here unless the status is `applied`.

### 6.13 WriteCommit

Executed by the `draft-revision` owner from the write plan, in the same transaction:

1. **Head table versions.** Absent → none. Unchanged or base → the S version. Other → the O version. A Draft version
   linked into Head is marked readonly with its rows. Mixed → a new readonly table version (same `createdId`, target
   public id, `system` and `createdAt` of the source) whose links are the S link set minus the replaced S row
   versions, plus the O row versions and the new merged row versions (readonly). Every row version the new Head links
   is readonly.
2. **Next-Draft table versions.** A relink candidate (§6.7) whose Draft version the content check finds equal to its
   new Head version → the new Head version (*draft follows Head*). The migration table when migrations
   were renumbered → a new mutable table version: the Draft links minus the renumbered rows plus new mutable row
   versions with the new `id`, `data.id` and `publishedAt` (other columns from the source). Otherwise → the Draft
   version read in the transaction.
3. Previous Head: `isHead = false`, `isDraft = false`, `hasChanges = false`.
4. Current Draft revision: `isHead = true`, `isDraft = false`, `hasChanges = false`, `comment`, table links replaced by
   step 1.
5. New Draft revision: `isDraft = true`, `parentId` = the new Head, same branch, table links from step 2 (`sequence`
   assigned as for native revisions).
6. Register the file references of the new row versions in tables whose target schema has File fields, after the
   relink, against the new Head (file-usage owner).
7. `hasChanges` of the new Draft = table-version difference between the new Head and the new Draft.
8. **After the transaction commits** (never for a rolled-back attempt): notify endpoints for revision X (the former
   Draft, now Head, whose content changed) and for the new Draft revision, through the `notifyEndpoints` hook native
   revert uses (§5.10).

### 6.14 WriteRevert

Executed by the `draft-revision` owner, in the same transaction; the Draft revision keeps its id:

1. Per table: unchanged → nothing; absent → unlink the Draft version; base or other → link that side's version
   instead of the Draft version; mixed → steps 2–3.
2. Mixed with S = Draft: if the Draft table version is mutable and keeps its public id, edit it in place (unlink the
   replaced row versions, link the Head versions and new mutable merged versions); otherwise create a new mutable
   table version from the Draft link set and link it instead.
3. Mixed with S = Head (the structure is reverted): create a new mutable table version from the Head link set minus
   the replaced rows, plus the kept Draft row versions and new mutable merged versions, and link it instead of the
   Draft version.
4. Relink candidates (§6.7): after the table version of steps 1–3 is written, link the Head version instead when the
   content check finds the written version equal to it (*draft follows Head*).
5. Apply the link changes to the Draft revision.
6. Register the file references of the new row versions after the relink, against the Draft (file-usage owner).
7. Recompute `hasChanges` (table-version difference between Head and Draft).
8. **After the transaction commits:** notify endpoints for the Draft revision, as native revert does after its
   transaction.

### 6.15 Write cost requirements

The limits of §11 were measured with a writer that meets these requirements (PoC fixes F1, F4 and F8; for example
locking in a 1M-row table with 1k changes fell from 7.1 s to 0 s). The writer (ADR-001) must meet them; a native
path that does not must not be reused unchanged.

| Step | Requirement |
| --- | --- |
| Readonly locking (commit) | Proportional to the changed rows: lock only the Draft versions newly linked into Head (for a whole Draft table version, an anti-join against the Head version), never a scan of every row of the Draft tables (native `createRevision` does that, §12). |
| Link copy of a mixed table | One set-based statement: the base link set minus the replaced versions by hash anti-join, plus the added versions. No per-row statements and no `NOT … = ANY(array)` filters. |
| New row versions | Set-based inserts in batches (one `INSERT … SELECT` per batch), not one statement per row. |
| File references | Only for tables whose target schema has File fields; set-based once the stage-0 item exists (§12), per-row until then (bounded by the per-row-work limit). |
| Content checks and digests | One SQL statement per table version pair (§6.7, §9.1). |

## 7. Storage

No database schema change: existing entities and relations only; no plan, token, receipt or journal records.

| Entity or relation | Read | Commit writes | Revert writes |
| --- | --- | --- | --- |
| `Revision` | Head and Draft of the branch | Previous Head flags; current Draft becomes Head (flags, `comment`, links); new Draft revision; its `hasChanges` | Draft links; `hasChanges` |
| `_RevisionToTable` | Links of both revisions | New Head link set; new Draft links | Disconnect and connect on the Draft |
| `Table` | Versions of both sides | New readonly versions for mixed Head tables; a new mutable migration table version when renumbering; `readonly = true` on Draft versions linked into Head | New mutable versions where an in-place edit is not possible |
| `_RowToTable` | Anti-joins to find changed rows; link counts; content checks of relink candidates | Link sets of new table versions | Link changes inside mutable Draft table versions; link sets of new versions |
| `Row` | Changed row pairs of affected tables; system rows; digests | New readonly merged versions; new mutable renumbered migration rows; `readonly = true` on Draft row versions linked into Head | New mutable merged versions |
| `FileBlob`, `_FileBlobToRow`, `ProjectFileUsage` | — | References of new row versions (file-usage owner) | Same |
| `TableMigration` | Branch lock (migration owner) | — | — |

Invariants:

- A table or row version linked by a non-Draft revision is readonly and is never updated; partial operations only
  create versions, change the links of the Draft revision and of mutable Draft table versions, and set `readonly` on
  versions that the new Head links.
- System tables keep their formats: schema rows (row id = table id, `data` = schema, `meta` = history patches),
  migration rows (row id = migration id, `publishedAt` = id), views rows, shared schema rows.
- Files: a version linked as is keeps its blob links; a new version gets references through the file-usage owner; a
  reverted file is restored by linking the Head value, without an upload.
- Detached versions (replaced Draft table versions, replaced Draft rows, old pending migration rows after
  renumbering) are left to the existing orphan cleanup, which also sweeps orphan blobs; project file accounting
  therefore matches native revert.
- Version ids of Draft tables that keep no units are not a contract; Head versions never change. Unread tables keep
  their Draft versions.

## 8. Transactions and concurrency

### 8.1 Commit and revert

- One Serializable transaction per attempt. Inside it: migration lock check, read, plan, decide, write and
  `hasChanges` recomputation. Each attempt plans from a fresh snapshot.
- The operations run their own attempt loop, independent of the engine-wide `TRANSACTION_MAX_RETRIES` of the native
  Serializable runner: retry only on serialization failures (`40001`, `40P01`, write conflict `P2034`), with backoff, up
  to `PARTIAL_CHANGES_MAX_ATTEMPTS` (default 3). A timeout is not retried.
- One operation timeout `PARTIAL_CHANGES_OPERATION_TIMEOUT_MS` per attempt (also for preview and listing, §8.2). The
  deadline starts with the attempt.
  - The runner races the operation against the deadline: the operation's callback settles with the timeout error at
    the latest 100 ms before the deadline, so the rollback reaches the server while the session is still alive, and
    Prisma rolls back on its awaited path. The abandoned operation runs on until its next statement fails on the closed
    transaction; the runner absorbs that failure. Prisma's own interactive-transaction timeout is the operation timeout
    plus 30 s; it does not fire, because the callback settles first.
  - The operation calls `checkpoint()` on its deadline between its phases; the runner calls it when the transaction
    starts and before it returns the result. A checkpoint after the deadline fails with the timeout error, so the
    attempt never starts COMMIT after the deadline. COMMIT itself can complete shortly after the deadline: PostgreSQL
    holds interrupts and does not apply `transaction_timeout` while it commits.
  - PostgreSQL 17 and later (the engine's Docker and CI setup): the first statements of the transaction set
    `transaction_timeout` locally to 0 and then to the remaining budget. A non-zero server or role default starts its
    timer at `BEGIN`, and a later local value neither extends nor shortens a running timer; the 0 stops it, so the next
    value starts a timer for this transaction only. At the deadline PostgreSQL terminates the session (`FATAL`,
    SQLSTATE `25P04`), whether a statement runs or the session is idle, so a statement is cut at the deadline.
  - Older servers (deployments run PostgreSQL 15 and 16): each checkpoint sets `statement_timeout` and
    `idle_in_transaction_session_timeout` locally to the remaining budget. The callback still settles at the deadline,
    but a statement in flight then runs until PostgreSQL stops it: at the latest when the budget that remained at the
    last checkpoint before the statement started is used up. The rollback, and with it the attempt, ends after that
    statement. A session that stays idle in its transaction for that budget, for example while the event loop is
    blocked, is terminated. Operations tighten the bound by calling `checkpoint()` between phases.
  - The settings are transaction-local: when the transaction ends, the connection returns to its own defaults, so a
    reused connection carries nothing from the operation.
- The attempt awaits the operation's result inside the transaction, so a lazy query returned without `await` also runs
  under the deadline.
- An error is the operation timeout only with evidence: the deadline race or a checkpoint after the deadline; SQLSTATE
  `25P04`; on servers without `transaction_timeout`, `57014` after the deadline; or a lost connection after the
  deadline the database enforces. Prisma `P2028` is never timeout evidence and keeps its type. The attempt loop reports
  a timeout as one error and does not retry it. Any other error keeps its type, even when its rollback ends after the
  deadline.
- Why Serializable and no locks: native writers take no row locks and run Serializable; SSI aborts the partial
  operation when a native write conflicts with what it read, and the retry includes that write. A ReadCommitted
  variant loses native writes and commits stale merged values.
- Two partial operations serialise: commits become consecutive revisions; the loser re-plans and becomes `applied`
  with what is left, `empty`, `blocked` (some selectors no longer match), or `stale` with `expected`.
- A commit turns the Draft revision into Head; native writes still addressed to that revision id fail (existing
  native contract).

### 8.2 Preview and listing

`READ ONLY` RepeatableRead transaction under the operation timeout (not the shorter default transaction timeout),
so a preview near a limit ends with `tooLarge`, not with a timeout; no retries. Preview reports an active async
migration as the blocker `migrationInProgress`; listing ignores the lock.

### 8.3 Migration lock and async migrations

- Commit and revert check the branch migration lock inside their transaction; an active async migration → error
  `MigrationLocked`. An async migration that starts while an operation plans makes it fail serialization; the retry
  sees the lock.
- Native revert cancels branch migrations in `PENDING` or `COPYING` and notifies endpoints; like `abortMigration`, it
  rejects a migration in `SWAPPING`, which is bounded ([async-row-migration-v2] §3.2, §3.6). Partial revert refuses
  until stage 0 (§17, question 2).
- **The fixed async migration** ([async-row-migration-v2] §3) is a recorded native `updateTable` run in batches: one
  active migration per revision, checked inside the start transaction; the schema validation of the synchronous path at
  start and data validation of every copied row; a guarded state machine with bounded recovery of every phase. The swap
  re-checks the Draft, the source table and the schema, writes the schema row and views row with copy-on-write, the
  `update` migration row and the schema history, and deletes the record in one Serializable transaction, so the Head
  and earlier revisions never change.
- Until stage 0, an async migration records no migration and no schema history. Async migration is on by default
  since v0.7.0 (threshold 1,000 rows), so deployed projects may already hold its results:
  - on a schema row the Draft already owned, the swap rewrites the Draft's own row: the Draft structure is not
    recorded, its commit is blocked (`unrecordedStructureChange`), its revert is allowed, data of other tables still
    commits;
  - when the Draft has not copied the schema row yet (the first async update of a committed table in a Draft), the
    swap rewrites the shared row in place, so the Head and every earlier revision linking that row version change,
    and relinks the Draft to the migrated shadow table (`migration/services/migration.service.ts:390-418`). The
    structure change is invisible from both sides (in the PoC a preview of `tables: [<that table>]` returned `empty`
    with the selector unmatched). Until the next native commit, the Head rows keep the old shape under the rewritten
    schema row (damage shape (i)); after it, the Head rows match the rewritten schema row and only the ledger is
    behind (shape (ii)). In both shapes the Head schema check refuses the table in every partial operation
    (`headSchemaInconsistent`, §6.10).

### 8.4 Write fence (native prerequisite)

Under continuous native writes to the same tables, a long Serializable commit (native or partial) is repeatedly the
serialization victim and fails after its attempts. Stage 0 adds a branch write fence for liveness (consistency is
already guaranteed by Serializable):

- native writers take the fence shared (#92); native and partial commit and revert take it exclusive; the
  async-migration start and swap and the forward-only repair take it shared and wait behind an exclusive holder;
  `applyMigrations` takes no exclusive fence and holds no fence while it waits for an async migration
  ([async-row-migration-v2] §3.9, §4);
- the exclusive fence is taken in a separate holder transaction before the Serializable snapshot, so in-flight writers
  drain first;
- the operation the holder protects runs in the `exclusiveHeld` admission mode of its transaction context for that
  branch: it skips shared admission for the branch (otherwise it would wait for its own holder), still checks the
  migration lock inside its transaction, and the holder is released on every exit (success, error, timeout);
- an operation takes it only after serialization failures (escalation), with these parameters (§17, question 3):
  - after 2 consecutive serialization failures, the next attempt and every later one run under their own holder; the
    attempt cap and the per-attempt timeout stay those of the operation's runner: `TRANSACTION_MAX_RETRIES` and
    `TRANSACTION_TIMEOUT` for native `createRevision` and revert, which do not use
    `PARTIAL_CHANGES_OPERATION_TIMEOUT_MS`; partial commit and revert reuse the holder and the admission mode through
    their operation runner;
  - before it checks out any connection, the escalated attempt takes an escalation slot; the process admits at most
    half of the connection pool (`max` of the pg pool the engine configures, 10 when unset, as pg-pool defaults) of
    escalated attempts at once, at least one, so escalations that each hold their own connection never all wait for a
    connection for their holder;
  - the escalated attempt then opens its holder before its first statement, so it already has its connection when
    writers start to queue behind the fence; the slot wait and the holder's wait for the exclusive lock together take
    at most half of `TRANSACTION_TIMEOUT` (the holder's `lock_timeout` is what the slot wait left), and the attempt's
    own timeout is `TRANSACTION_TIMEOUT` minus the slot wait; past the wait limit the operation fails with
    `BranchWriteFencedException` (`BRANCH_WRITE_FENCED`, HTTP 423) without a retry, and nothing stays held; for partial
    operations each wait is also capped by the time left in the operation, and a wait the operation deadline cuts
    short fails with the operation timeout instead, not retried;
  - the holder transaction stays open until the attempt's transaction has committed or rolled back, even when a
    statement or the COMMIT in flight keeps the attempt past its own timeout; the holder's own timeout is the attempt's
    timeout plus a fixed grace of 30 s and only bounds how long an attempt that never ends keeps the fence;
  - native revert is a Draft writer: its first two attempts take the fence shared, so it waits behind another
    operation's holder like every writer; in every attempt it cancels the branch migrations instead of checking the
    migration lock;
- connection pool: an escalated attempt holds two connections at once, its own and the holder's; the escalation slots
  keep escalated attempts to half of the pool, and writers queued behind a holder hold their connections for at most
  their wait limit;
- consequence for native writers: every native writer takes the shared fence, and while an operation holds it
  exclusively, writers wait at most half of `TRANSACTION_TIMEOUT`, then fail with `BranchWriteFencedException`
  ([async-row-migration-v2] §1). The evidence for the fence's effect under load is one benchmark prototype (PoC M3).

## 9. Freshness and idempotency

### 9.1 Fingerprint

An unsigned, opaque string with four parts, so that a `stale` result can say which of them changed (§9.2):

| Part | Holds |
| --- | --- |
| operation | `commit` or `revert`. |
| revisions | The Head revision id and the Draft revision id. |
| units | SHA-256 over the internal keys of the applied units (selected and required), in unit order. |
| content | SHA-256 over the content of every applied unit, in unit order (below). |

Encoding: `pcf2.` followed by the base64url (no padding) of the UTF-8 JSON array `[operation, headRevisionId,
draftRevisionId, units, content]`, the two digests as lowercase hex. `pcf2` names the version of the fingerprint
rules; the engine compares the parts one by one. Clients treat the fingerprint as opaque and compare it only for
equality. An `expected` is read by its prefix, where `n` is one or more decimal digits: `pcf2.` followed by a payload
that decodes to a five-element array of strings is a fingerprint of these rules; `pcf<n>.` with another `n` and a
base64url body is a fingerprint of other rules (a later engine version), whose payload is not decoded, and gives
`stale` with `changed: ['version']`; anything else is malformed (§5.9), including the bare SHA-256 hex that engines
before v2.0 issued. The content part covers, for every applied unit, in unit order:

  - row units: per covered row, the Head and Draft row versions as `versionId`, `updatedAt` and the compared columns
    (`id`, `hash`, `schemaHash`, `publishedAt`, `meta`); for a `rowColumns` unit, the columns it owns (§3.4); for a
    `rowCreate`, `rowDelete` or `rowReplace` unit that moves a row into the other structure (§6.7, row outcome 1), the
    structures it moves the row between: the Head and Draft schemas, the pending schema history and the unchanged
    fields (§3.3);
  - table-level units (structure, views, shared schema): the Head and Draft table version ids and the owned system
    rows (schema, views, pending migration rows) as above;
  - structure units whose Draft table version is mutable: a digest over the row count and the `versionId` and compared
    columns of every row of that version.

`updatedAt` and the compared columns are needed because native writes update a mutable version in place. The structure
digest makes structure freshness table-wide: any edit of that table's Draft rows, including a `publishedAt` or `meta`
edit that leaves `hash` unchanged, makes a selected structure unit `stale`. Consequences: a structure commit of a table
that others keep editing keeps returning `stale` (S3, S4), and the digest costs one pass over every row of that
table version per plan, O(table rows): 3.3–3.5 s per million rows (§11). The
fingerprint covers applied units only, so it does not depend on which tables were read (AS-74).

The fingerprint covers the selected content and the structures that an existence unit moves a row between. Ownership
follows the structure as well as the row versions (§3.1): a table rename after the preview leaves every row version as
it was but hands `schemaHash` to the structure unit, so a `rowColumns` unit then owns fewer columns, and a created,
deleted or replaced row starts to move into the other structure. A Draft schema change after the preview of a table
whose structures already differ leaves a Head row version as it was but changes the Draft structure that a restored
row is migrated into. Each of these changes the fingerprint, so the operation returns `stale` instead of writing a row
that the preview did not show. The structures are covered only for a unit that moves a row: a committed deletion and a
reverted creation write no row, and a schema change of another table changes nothing in the unit's table, so their
fingerprints stay the same. A `field` unit names its leaf in its key and no longer exists once that leaf is
structure-bound, and `id` always belongs to the `rowRename` unit.

Unless an applied `rowColumns` unit owns it (§6.7), the `schemaHash` of a written row follows the schema of its target
table at apply time, also for a `field`, `rowRename` or `rowColumns` unit whose ownership did not change: after a
native rename of a referenced table rewrote the referrer's Draft schema, a referrer row that a revert merges takes the
hash of the rewritten schema. That hash is technical state, not selected content; a `schemaHash` that a `rowColumns`
unit owns is selected content and is written as the preview showed. Values that the apply generates, such as timestamps or the new `fileId`
that the File plugin assigns when a restored row is migrated through a pending File field, come from the apply, and
the preview does not fix them.

### 9.2 Rules

- `expected` is optional in the engine and required at the public API and MCP for partial operations (§5.10).
- `includeRequired: true` requires `expected`: required additions are applied only as reviewed.
- A commit fingerprint never matches a revert, and the reverse.
- A repeat of an applied commit or revert resolves to no unit → `empty` with the current ids; if part of the
  selection still resolves, `expected` gives `stale` and a selection with some unmatched selectors is `blocked`.
- A request with `expected` is never applied twice: its fingerprint covers the units it applied, so a repeat, also a
  concurrent one, is `empty`, or `stale` when its selection now resolves to other units.
- A request without `expected` (internal callers, or exactly `{ all: true }`) re-resolves its selection against the
  current state on every call. When ids are reused, an identical repeat can address a different unit: after row `a`
  is renamed to `b` and a new row `a` is created, `rows: [a]` first reverts the new `a`, and the same request again
  resolves `a` through Head and reverts the rename.
- A plan refused by a limit returns `blocked` (`tooLarge`), never `stale`, also when the Draft grew past the limit
  after the preview.
- **What a `stale` result says.** `changed` lists, in this order, the parts of `expected` that differ from the
  current plan's fingerprint (§9.1):

  | `changed` | Meaning for the caller |
  | --- | --- |
  | `version` | `expected` was issued under other fingerprint rules (another engine version); no other part is compared. |
  | `operation` | `expected` is the fingerprint of the other operation (a commit preview passed to a revert, or the reverse). |
  | `revisions` | The Head or the Draft revision is not the one previewed: a commit happened since (a partial commit of other units; a whole-Draft commit leaves nothing of the selection, so its repeat is `empty`), or `expected` is of another branch. |
  | `units` | The selection now resolves to other units: a selected unit appeared or disappeared, or the required additions changed. The content is then not compared. |
  | `content` | The same units, and the content of at least one of them changed: a selected field edited again, a selected row's other content, schema, views or migration row edited without adding or removing a unit, or a row of a selected structure's table (the structure digest). |

  `revisions` is compared independently of `units` and `content`: after a partial commit of other tables, the selected
  units and their content can be unchanged, and `changed` is `['revisions']`. The result also carries the current
  `headRevisionId` and `draftRevisionId` and the current `unmatched`, so a caller drops the selectors that no longer
  match before it previews again. It carries no new fingerprint: the caller previews again to review the new plan.

## 10. Migration history and replicas

### 10.1 Attribution

Pending migrations are replayed in id order from the Head table ids: `init` opens a slot, `rename` moves it, `remove`
closes it. Each slot ends at a Draft table identity (its structure unit) or is transient (§3.5). Every pending
migration belongs to exactly one structure unit. A pending migration that cannot be attributed (for example an
`update` or `rename` of an id with no open slot), or a Draft schema history that does not extend its Head history,
makes every preview, commit and revert `blocked` with `ledgerInconsistent` (`listChanges` returns no status): such a
migration could be neither published nor reverted.

### 10.2 Rules

- Published migrations keep their ids and row versions.
- A commit publishes the pending migrations of the applied structure units with their Draft ids.
- Renumbering (§6.8) applies only to migrations that stay in the Draft, only when one of them would precede a
  published id; the commit result lists every change in `renumberedMigrations`.
- A revert drops the pending migrations of reverted structure units from the Draft ledger.
- Every resulting ledger replays to its schemas (§6.9).
- A table rename rewrites referrer schemas natively without migration rows; the replayed `rename` rewrites them on a
  replica, so a rename and the referrers it rewrote are published together (`referrerStillReferences`).

### 10.3 Guarantees

| Consumer | Guarantee |
| --- | --- |
| Replica synced from Head exports (`getMigrations` of Head → `applyMigrations` into its Draft → commit) | Accepts every partial commit and every later commit; its replayed schemas equal the source Head schemas (REQ-001.BR-004). `applyMigrations` applies one migration per transaction, so the guarantee is incremental, not all-or-nothing: the replica's ledger is always a prefix of the source Head ledger, each migration applies atomically, and a resumed sync continues from the next id (with the stage-0 in-transaction id check). Depends on the stage-0 must items (§12), including the async-migration fix and copy-on-write by `INSERT … SELECT`. An imported `update` above the async threshold keeps its source id: the swap records it, and `applyMigrations` reports `applied` only then ([async-row-migration-v2] §4). Async migrations in flight at upgrade carry no source id and are cancelled (`LEGACY_JOB`), so an import that started one is rerun. Not covered: an exactly `{ all: true }` commit of an unrepaired damaged table (§6.10) publishes a Head no replica can reproduce, exactly as native commit does; unledgered tables (§6.10) were never received by a replica through migrations, and partial operations refuse them. |
| Replica synced from Draft exports | Unsupported: a renumbered migration is offered again under a new id and fails (for example "field already exists"). `renumberedMigrations` lets such a consumer detect it. |
| Replicas of large tables | Native limits apply independently of partial commits: memory of synchronous table updates (backlog, §12). |

## 11. Limits and configuration

The defaults are **conservative**: each keeps the cost it bounds at about 20 s or less on the PoC sandbox (runs there
varied up to ±2×), far above today's production sizes, where no table holds 1,000 rows. No measurement on
production-like hardware gates the release. A host raises a limit through its environment once the operation logs
(§11.1) show what operations really cost. The PoC sandbox (2 CPU, 4 GB) measured at 100k changed rows (cases as named
in the [research summary](../research/partial-changes-poc-v2.md)):

| Measure | Value | Cases |
| --- | --- | --- |
| Preview | 8.4–9.6 s | `preview` of 50% rows; `preview-required` with a 3-step closure (FK/files dataset) |
| Commit without per-row work | 19.1–43.9 s | `commit-required` (19.1 s) to `commit-rows` of 50k rows (43.9 s; 26.7 s in a second run) |
| Revert without per-row work | 9.9–14.2 s | `revert-required` to `revert-rows` of 50k rows |
| Per-row work | 99.7–172.2 s | `commit-field` with 50,000 formula merges (99.7 / 142.5 s); `revert-photos`, `commit-prices`, `commit-photos` with 30,000 merges with formulas and files (158.1, 169.0, 172.2 s, of which file registration 102.4–107.8 s) |
| Peak RSS | up to 1.36 GB | FK/files 100k |
| Unit costs | ~4.4 KB planning memory per changed row; ~61 s per 1M copied links of a mixed table; ~1.6 ms per merged row with a formula; ~3.5 ms of file registration per merged row with a file | |

Scoped reading: a one-field commit next to a changed unrelated table of 200,000 rows took 58 ms in the transaction
(median of 3; 51 ms without that table), while the same commit reading every table was refused with `tooLarge`. The
structure digest (§9.1) costs one pass over the table version: its query took 0.37–0.40 s for 100,000 rows and
3.3–3.5 s for 1,000,000 rows (3 runs each; PostgreSQL 17 in Docker on a 12-core development host, warm cache, the
query alone on a synthetic table version; 2026-11-10). No limit bounds it; the operation timeout does.

| Setting | Default | Counts | Effect |
| --- | --- | --- | --- |
| `PARTIAL_CHANGES_MAX_CHANGED_ROWS` | 20,000 | Changed rows of the affected tables (§6.2); an affected table counts in full | Above → `tooLarge` before the catalogue. |
| `PARTIAL_CHANGES_MAX_PER_ROW_WORK` | 2,000 | Merged or converted rows in mixed tables whose target schema has formula or File fields | Above → `tooLarge` before the closure assembly that would exceed it (§6.5). |
| `PARTIAL_CHANGES_MAX_MIXED_TABLE_LINKS` | 100,000 | Links copied into one new table version (an in-place revert copies none) | Above for any table → `tooLarge` with `tableId`, before that assembly (§6.5). |
| `PARTIAL_CHANGES_OPERATION_TIMEOUT_MS` | 180,000 | Lifetime of one preview, one listing page, or one commit or revert attempt | Expired → error, rollback; the callback settles at the deadline and COMMIT never starts after it; a statement is cut at the deadline by `transaction_timeout` on PostgreSQL 17, and within the budget left at the last checkpoint on older servers (§8.1). |
| `PARTIAL_CHANGES_MAX_ATTEMPTS` | 3 | Serializable attempts of the operation's own loop (§8.1) | Exhausted → error. |
| `listChanges` `pageSize` | 500 (max 5,000) | Units per page, and changed row ids read per page (§5.2) | — |
| Draft reads `first` | none (1 to 5,000) | Table or row items per page of `changes.tableChanges` and `changes.rowChanges` ([draft-reads-v1](draft-reads-v1.spec.md) §1), the maximum of `pageSize` | Outside → validation error, before the snapshot. |

Where the defaults come from, scaled linearly from the measurements above:

| Setting | Was | Worst case at the default |
| --- | --- | --- |
| `PARTIAL_CHANGES_MAX_CHANGED_ROWS` | 100,000 | Preview ~2–8 s (~2 s from 8.4–9.6 s at 100k, ~8 s from 3.9 s cold at 10k × 10k; up to ~16 s at the spread); commit or revert without per-row work up to ~18 s (43.9 s for 50k rows); planning memory ~90 MB (~4.4 KB per changed row). |
| `PARTIAL_CHANGES_MAX_PER_ROW_WORK` | 10,000 | Up to ~12 s: 2.0–3.9 ms per merged row with a formula (99.7–142.5 s for 50,000; 19.6 s for 5,000), 5.3–5.8 ms with formulas and files (158–172 s for 30,000; 17.1–17.5 s for 3,000), measured before set-based file registration landed in #94. |
| `PARTIAL_CHANGES_MAX_MIXED_TABLE_LINKS` | 250,000 | ~6 s per mixed table: ~61 s per 1M copied links on the sandbox. The limit is per table, so several large mixed tables add up; only the timeout bounds their total. |
| `PARTIAL_CHANGES_OPERATION_TIMEOUT_MS` | unchanged | One attempt at every limit with one mixed table stays under ~40 s, about twice that at the measured spread; each further large mixed table adds ~6 s; a retried commit or revert runs up to `PARTIAL_CHANGES_MAX_ATTEMPTS` attempts, each with its own timeout. The timeout stays at 3 minutes because the scan, the repair and the backfill run under the same runner (async-row-migration-v2 §5, §6; schema-ledger-backfill-v1 §3). |
| `PARTIAL_CHANGES_MAX_ATTEMPTS` | unchanged | Two shared attempts and one under the exclusive fence (§8.4). |

The engine reads every setting from its environment once, at startup. A value that is not a whole decimal integer
(such as `1e5`, `100_000` or `2000abc`), is below 1, or is above the largest safe integer keeps the default and logs a
warning (the timeout is also bounded by what a Node timer accepts, about 24.8 days); the effective values are logged
once (`Partial changes limits: …`, `Partial operation settings: …`), each that differs from its default with the
variable it came from.

`all: true` reads every table, so a Draft above `maxChangedRows` can be committed whole only natively.

### 11.1 Operation logs

Each listing page, preview, commit and revert logs one structured entry when it ends (`PartialOperationLog`, through
the engine's NestJS logger): `log` when it returns, `warn` when it throws. The entry has `message`
`Partial changes operation finished` and these fields:

| Field | Value |
| --- | --- |
| `operation` | `list`, `preview`, `commit` or `revert`. |
| `projectId`, `branchName` | From the input, when they are strings. |
| `headRevisionId`, `draftRevisionId` | The revisions the plan of the last attempt (or the listing page) read; absent when the last attempt failed before planning. |
| `durationMs` | From the start of the operation to its result, endpoint notification excluded. |
| `outcome` | The result's `status` (`ready`, `applied`, `blocked`, `required`, `stale`, `empty`), `listed` for a listing page, or `error`. |
| `attempts`, `escalations` | Attempts started, and how many of them were escalated to the exclusive fence (§8.1, §8.4), counted even when one ends waiting for the fence; `0` when the input, a commit comment included, was refused before any. |
| `tooLarge` | Preview, commit and revert: whether a limit stopped the plan. |
| `estimate` | Only when `tooLarge`: `changedRows`, `mergedRows`, `perRowWorkRows`, the number of `mixedTables` and the largest `linksCopied` (`maxLinksCopied`). |
| `refusedTables`, `refusedTableIds` | The number of refused tables (§6.10) and the first five of their ids. |
| `error`, `errorCode` | Only on `warn`: the error's name and its code (an engine code such as `OPERATION_TIMEOUT`, or a database code such as `P2034`). |

An entry never holds row data, values, selectors or an error message, since a message can quote them. The
endpoint notification after a commit or revert is outside the entry: a failing notification is the caller's error,
not the operation's outcome. Logging is best effort: a logger that throws changes neither the result nor the error the
caller gets.

## 12. Native prerequisites (stage 0)

**One release gate.** No partial operation is released before every "must" item below and the release gate are done.
Delivery stages 1–3 (ADR-001) may be developed in parallel with stage 0. Paths are under `src/features/` at master
`139eb7b` unless they start with `src/` or `prisma/`.

**Async migration fix, detection and repair** (its own stage-0 design: [async-row-migration-v2], the new version of
[async-row-migration-v1]). This SPEC depends on these results:

| Requirement | Today (139eb7b) | Where |
| --- | --- | --- |
| Copy-on-write of the schema and views rows before the swap; the swap writes the `update` migration row and the schema history with the migration's original patches. | The swap updates both rows in place by `versionId` and records nothing, so every revision linking those row versions changes (§8.3). | `migration/services/migration.service.ts:450-457` (schema row), `:500-508` (views row) |
| The swap re-checks that the revision is still the Draft and the source table is still linked. | No re-check. | `migration.service.ts:390-418` |
| One async migration per revision at a time, checked inside the transaction. | A unique key blocks a second one on the same table only; other tables are guarded by a check outside the transaction. | `migration/commands/handlers/start-async-migration.handler.ts:33-99`; `draft/commands/handlers/api-update-table.handler.ts:35` |
| Validation equal to the synchronous path (foreign-key targets, formulas, data). | Meta-schema only. | `start-async-migration.handler.ts:69-77` vs `draft/commands/handlers/transactional/validate-schema.handler.ts:23-48` |
| File references for migrated rows. | Migrated rows get no blob links. | `migration/services/migration-batch.service.ts:84-112` |
| Orphan cleanup spares in-flight shadow tables. | It deletes every table no revision links, including shadow tables before their swap. | `src/infrastructure/database/cleanup.service.ts:41-51`; `migration.service.ts:240-250` |

All rows have landed (statuses in [plan](../plan.md)); [async-row-migration-v2] §3.3–§3.7 is their design.

- **Detection (scan):** `scanSchemaLedger` ([async-row-migration-v2] §5). It covers every revision of every branch
  and evaluates each predicate once per distinct combination of shared versions. It reports unledgered tables;
  unreplayable ledgers (a tainted slot, for example after a later published migration built on the unrecorded change);
  damaged Head tables with their shape and planned repair outcome; Draft-only damage; damaged history; and predicate
  (a) failures as a diagnostic only, classified by their known false-positive sources. Predicate (a) refuses nothing.
  Views are covered as §6.10 describes.
- **Repair (forward-only):** `repairSchemaLedger` ([async-row-migration-v2] §6). Nothing committed is rewritten
  again. In the Draft, the repair writes only what recorded native schema writes would have written: ledger rows and
  schema history, no rows and no views copy. Per damaged Head table the patch is the diff from the schema replayed from
  the Head ledger to the Head schema row (a field rename becomes remove and add, so replicas that apply the repair lose
  that field's values). Coupled candidates are planned and verified together; one global sequence after the last
  published migration numbers the repairs, and the pending migrations are renumbered once after them, as in §6.8.
  Draft rows must pass data and foreign-key validation, and a validation fingerprint proves them unchanged at the
  write; the write verifies the published prefix and the stored ledger. A table that cannot be repaired gets its
  outcome ([async-row-migration-v2] §6.2) and nothing is written for it, for example `needsDraftStructureRevert` when
  its Draft structure must be reverted first (natively or with a whole-Draft revert, since partial operations refuse
  the table).

  The table becomes eligible for partial operations again only after a native or exactly `{ all: true }` commit
  publishes the repair (§6.10); earlier revisions stay as they are, and rewriting history would need its own ADR and
  is not planned. The repair is not a gate for partial operations: the refusal of §6.10 protects damaged tables, and
  native or `{ all: true }` commits still work. Draft-only damage (§6.10) needs no repair: reverting the table's
  structure unit removes it.
- **Tables whose ledger slot is tainted** (§6.10) cannot be repaired forward: such tables stay refused, and their
  Head-synced replicas need a re-sync.
- **Ledger backfill** for branches without a migration table is specified in
  [schema-ledger-backfill-v1](schema-ledger-backfill-v1.spec.md); **row remediation** for damaged tables whose Draft
  rows fail validation (`rowsNeedMigration`) is decided with the scan results ([async-row-migration-v2] §7). Neither is
  a release gate. Until a branch is backfilled or a remediation exists, partial operations refuse those tables
  (`unledgeredTable`, `headSchemaInconsistent`).
- **No change to table rename** in stage 0: re-hashing the referencing rows would copy every row of every
  referencing table; predicate (a) reports such tables as known false positives instead.
- **Release gate:** the async migration fix shipped; the forward-only repair tool; the scan run on existing
  deployments with its results reviewed (damaged tables and history, tainted ledger slots, unledgered tables, the
  predicate (a) diagnostics with their known false positives, and the host-side check for files possibly lost before
  the fix, [async-row-migration-v2] §13); the Head schema check
  (`headSchemaInconsistent`, `unledgeredTable`) in partial operations; conservative configurable limits with the
  operation logs (§11, §11.1) instead of a re-measurement on production-like hardware.

**Other items.**

| Priority | Item | Why | Where |
| --- | --- | --- | --- |
| Must; landed (#115) | `applyMigrations` starts the async migration of a large `update` with its source id and reports `applied` only after the swap recorded it; the source id travels in the payload envelope, and a Draft without a migration table fails with `LEDGER_UNAVAILABLE` ([async-row-migration-v2] §4). | Above the threshold the update goes async, is reported `applied`, writes no ledger row, and later migrations of the batch hit the lock. | `draft/commands/handlers/migration/apply-migrations.handler.ts:107-112, 126-129`; `draft/commands/handlers/api-update-table.handler.ts:37-38` |
| Must; landed (#87) | `applyMigrations` checks the migration id inside the migration's transaction. | The existence and id checks run outside any transaction (race). | `apply-migrations.handler.ts:141-162, 164-188` |
| Must; landed (#86, #89) | Migration lock checked inside the writer's transaction, in every API writer; views writes check it at all. | Every API writer checks before its transaction starts; views writes do not check. | `draft/commands/handlers/api-create-revision.handler.ts:25-28` vs `:33`; `api-create-row.handler.ts:35` vs `:37`; `api-update-table.handler.ts:35` vs `:61`; `views/views-api.service.ts:31-37` |
| Must; landed (#88) | Referrer rewrites and the row-removal guard without the 100 limits. | A row rename rewrites at most 100 rows per referrer table and searches at most 100 referrer tables; a table rename rewrites at most 100 referrer schemas; the row-removal guard checks at most 100 referrer tables and fails above 1,000 paths × row ids. Native commit publishes the dangling rest. | `share/foreign-keys.service.ts:8, 89, 157, 212-217`; `draft/commands/handlers/transactional/internal-rename-row.handler.ts:108-118, 167-183`; `transactional/rename-schema.handler.ts:55-59`; `draft/commands/handlers/remove-rows.handler.ts:74-80` |
| Must; landed (#86) | Serializable views writes. | Views writes run with default isolation, so a concurrent update can change a views row that a commit has just published. | `views/views-api.service.ts:31-37`; `views/commands/handlers/update-table-views.handler.ts:55-88` |
| Must; landed (#92, #119) | Branch write fence (§8.4). | Long Serializable commits (native and partial) starve under continuous writers. Evidence: one benchmark prototype. | `src/infrastructure/database` and native writers |
| Must; landed (#85) | Table copy-on-write by `INSERT … SELECT`. | The first native edit of a table loads every row version id and connects them in one write; the PoC hit `P2029` above 32,767 rows (32,800 in M5, the replica sync in M3). Large tables and the replica guarantee depend on it. | `draft-revision/commands/handlers/draft-revision-get-or-create-draft-table.handler.ts:103-115, 117-145` |
| Should; landed (#91) | `createRevision` finds the rows to lock without scanning shared readonly rows. | Its lock is one `updateMany` that updates only mutable rows, but its filter joins every row of every table version of the revision, shared readonly ones included (7.8 s for 1k changes in a 1M-row table). | `draft-revision/commands/handlers/draft-revision-commit.handler.ts:97-105` |
| Should | Formulas compiled once per schema. | Formulas are parsed per formula per row; dominates merges. | `plugin/formula/formula.plugin.ts:49-79` → `plugin/formula/formula-calculation.ts:13-15` |
| Should (landed, #94) | Set-based file registration for row versions. | Several queries per row. | `file-usage/commands/handlers/register-file-references-for-rows.handler.ts:52-54, 93-137` (called by `register-file-references-for-row-versions.handler.ts`) |
| Documented, not a fix | `applyMigrations` runs one transaction per migration and stops at the first failure. | Accepted: the replica guarantee is incremental (§10.3). | `apply-migrations.handler.ts:35-46` |
| Backlog | Memory of synchronous and async table updates. | The synchronous update holds the whole table in memory; 100k-row updates exhausted a 2 GB heap in the PoC. | `draft/commands/handlers/update-table.handler.ts:116-137, 152-162`; `migration.service.ts:281-338` |
| Backlog | Prisma default 5 s timeout on transactions run without options. | Views writes and async copy batches run without options. | `src/infrastructure/database/prisma.service.ts:13-19`; `src/infrastructure/database/transaction-prisma.service.ts:197-208, 224-231`; `migration.service.ts:316`; `views/views-api.service.ts:32` |
| Backlog | Native diff queries join the whole `Row` table and compare only `id` and `hash`. | Cost grows with the database; `publishedAt` and `meta` edits are invisible to them. | `prisma/sql/countRowChangesBetweenRevisions.sql:38-53`; `prisma/sql/getRowChangesPaginatedBetweenRevisions.sql:121-135` |
| Backlog | Views migration of nested paths. | It strips one `properties/` only, so nested paths are mangled. | `share/views-migration.service.ts:191-202` |

## 13. Acceptance scenarios

PostgreSQL through the real engine APIs; fixtures by native writes. A defect state that no native write can produce
after stage 0 (a dangling reference past the old 100-referrer limit, an unrecorded or in-place rewritten schema, an
unattributable migration, a table without an `init` migration) is written by SQL in the fixture and checked by the
scenario's first assertion; the committed-versions guard accepts exactly the rows such a fixture writes. "Committed
versions unchanged" (§14) holds in every scenario.

### 13.1 REQ-001.BR-003 (and REQ-001.BR-002 S1, S2)

- AS-01 Two edited rows, one selected for commit → Head has that row's Draft version and the other row's Head version;
  the new Draft keeps both edits and `hasChanges = true`; schema history and ledger unchanged.
- AS-02 One of two edited fields committed → Head row is a merged version (that field from Draft, the other from
  Head), formula recomputed, `hash` matches the data; the Draft keeps both edits.
- AS-03 Created and deleted rows, selected and not selected → applied ones in Head, others only in the Draft.
- AS-04 Revert of one row, one field, one rename → the row or value equals Head; other edits stay; the Draft revision
  id is unchanged; formulas recomputed.
- AS-05 Last remaining unit committed or reverted → the tables the operation read link Head versions; Draft
  `hasChanges = false` unless an unread table still holds content-equal versions (§3.8).
- AS-06 `comment` is stored on the new Head.

### 13.2 REQ-001.BR-007 (and REQ-001.BR-002 S4)

- AS-10 `products` gets field `color` while prices change → prices commit alone; later `structures: [{ tableId: 'products' }]`
  commits `color` with its values.
- AS-11 Structure committed while edits of unchanged fields are not selected → those edits stay only in the Draft;
  `tableData` selects only them.
- AS-12 A value of a changed field selected alone → `required` (`structureBoundData`).
- AS-13 A created row committed without its structure → Head defaults for the changed fields; preview lists them in
  `deferred`; nothing deferred when the structure is selected too.
- AS-14 A created table commits whole with its rows; a row selector of a created table → requires the structure.
- AS-15 A Head row whose deletion stays in the Draft is migrated into the committed structure; formulas of merged rows
  use the target structure.
- AS-16 Reused row id → one `rowReplace`; removed and re-created table id → one structure unit; a table created and
  removed inside the Draft → one structure unit that commits alone, reverts out of the ledger and keeps a replica in
  sync; two incarnations of one id → one unit.
- AS-17 Rename: rename alone (`rowRenames`), field edit alone under the Head id, whole renamed row links the Draft
  version; a listed `rowRenames` selector does not take a field edit made after the listing.
- AS-18 Selectors: pointer inside an array → `atomicValue`; field of a created row → `wholeRowUnit`; formula output →
  `notSelectable`; nested pointer and object pointer; excluded pointer inside an array excludes the array.
- AS-19 A views edit of a table without a structure change commits and reverts alone; the views of a table whose
  structure changed, migrated and edited alike, commit and revert with its structure (§3.6, AS-82).
- AS-20 A shared schema change commits and reverts alone.
- AS-21 Row columns (§3.1). A `RowPublishedAt` edit is listed as a `field` unit at its path; that unit commits and
  reverts it (read back through the field); it stays in the Draft when another field of the row, another table, or a
  table it references is committed or reverted. A `publishedAt` difference without a published-at field (the field
  removed by the structure) and a `meta` difference (written by the native internal command) are `rowColumns` units;
  they stay when the structure is committed and commit later alone. With the published-at field new or changed, the
  column follows the structure unit.

### 13.3 REQ-001.BR-004 — references, identities, files

- AS-30 A selected row references a created row → `required` (`referencedRowMissing`); with `includeRequired` and
  `expected` both are committed.
- AS-31 A selected deletion of a row still referenced by an edited referrer → the referrer edit is required; excluded →
  `blocked` (`requiredExcluded`); referenced by an unchanged row → `blocked` (`danglingInSource`).
- AS-32 A rename of a referenced row requires the referrer edits it rewrote, and the reverse; together they commit
  without a dangling reference.
- AS-33 One half of a row or table id swap → the other half `required` (`idOccupied`); with it → applied, unique ids.
- AS-34 A rename into an id vacated by a deletion requires the deletion; the deletion is addressable with
  `side: 'head'`.
- AS-35 A created row whose changed field is a foreign key requires the structure (`structureBoundData`) and commits
  with it.
- AS-36 A Draft already holding a dangling reference (SQL fixture; natively a rename over 100 referrers before stage
  0) → `all: true` is `blocked` (`danglingInSource`): `all: true` refuses inconsistency it would publish.
- AS-37 Revert: reverting a created row that remaining edits reference requires those edits; together they revert; a
  reverted field that points to a deleted row requires restoring that row.
- AS-38 Files: a file field commits without other edits; blob links and project bytes equal those after native
  whole-Draft commit; a reverted file is linked back without upload; structure revert of a renamed table with a File
  field and of a removed File field restores the Head files with native-equal accounting.
- AS-39 Failure injected after the writes (commit, revert, with and without files) → nothing persisted, including file
  references; committed versions unchanged.

### 13.4 REQ-001.BR-004 — structure, ledger, replicas, async

- AS-40 Structure of `orders` (migration 2) committed before `products` (migration 1) → Head keeps migration 2's id;
  migration 1 is renumbered after it and reported in `renumberedMigrations`; a Head-synced replica accepts this commit and the
  later one; replayed schemas equal the source; no renumbering when not needed.
- AS-41 Property sequences (fixed seeds, 20 steps: native edits, native and partial commits and reverts) start with a
  partial commit that renumbers; every step's status is asserted; after every step every pending Draft migration id
  is greater than the last published id; a final `all: true` leaves nothing and the replica equals the source.
- AS-42 A replica synced from Draft exports fails on a renumbered migration (recorded, unsupported).
- AS-43 A renamed table referenced by another table requires the referrer's structure and the reverse; together they
  keep a replica in sync. A schema foreign key to a created table requires that table. Ledger dependencies (§6.6), for
  the examples in revert and commit: each required unit carries its selector, and `because` names the migration
  and the table id; adding the selectors closes with nothing required; the revert applies and the Draft ledger replays
  to its schemas; the new Head and remaining Draft ledgers of the commit replay (commits are checked at the target
  level until structure commits apply); an excluded required unit → `blocked` (`requiredExcluded`). A reference behind
  a failure the Draft ledger already has (SQL fixture of an unrecorded field moved natively) requires nothing, and the
  revert applies.
- AS-44 Structure revert of one of two tables → remaining Draft rows mapped back (Head values for changed fields of
  existing rows, Head defaults for created rows), the other table untouched, its migrations dropped, the remaining
  ledger replays; created table reverted with its rows; removed table restored.
- AS-45 Views on a new field: the views edit is part of the structure unit of its table; committing the structure
  commits the views, reverting it restores the Head views; `views: [table]` requires the structure
  (`structureBoundData`).
- AS-46 Async migration active → commit and revert raise `MigrationLocked`; preview is `blocked`
  (`migrationInProgress`). A completed async migration on a schema row the Draft already owned (Draft-only damage,
  SQL fixture after stage 0) → the table is not refused (the Head passes predicate (b)); its structure commit is
  `blocked` (`unrecordedStructureChange`) and data of other tables commits; reverting its structure unit is `applied`,
  after which the Draft schema equals the Head schema and nothing is unrecorded. An async migration starting while a
  structure commit plans → the commit is refused.
- AS-47 Head schema check. Fixtures (SQL), one per damage shape (§6.10): (i) a completed async migration rewrote a
  committed table's shared schema row in place and the Head rows were never migrated; (ii) the same, then published by
  a native commit, so the Head rows match the rewritten schema row and only the ledger is behind. The Draft also holds
  edits of that table and of another table. Each case below is its own scenario for both shapes; in every refused case
  units of other tables still apply and nothing of the damaged table is written.
  - AS-47a A partial commit of the damaged table's units (data, row or structure) → `blocked`
    (`headSchemaInconsistent`).
  - AS-47b A partial revert of the damaged table's units (data, row or structure) → `blocked`
    (`headSchemaInconsistent`).
  - AS-47c After the forward-only repair (§12; outcome `repaired`) but before it is published, every partial
    operation on the table is still `blocked`, and a second repair returns `alreadyRepaired`. After a native commit
    publishes the repair, the table's Head ledger replays to its Head schema (the repair returns `notDamaged`), a
    partial commit of its units applies, and a Head-synced replica applies the repair migration.
  - AS-47d `listChanges` lists no units of the damaged table and returns it in `refusedTables`; a preview that selects
    it returns `blocked` (`headSchemaInconsistent`), not `unmatched`.
  - AS-47e Head-schema-row baseline (unrepaired Draft): exactly `{ all: true }` commit and revert produce the same
    Head, Draft and ledger as native `createRevision` and `revertChanges`, with no `unrecordedStructureChange`;
    native commit stays available; `{ all: true, exclude }` → `blocked`.
  - AS-47f A table that fails only predicate (a) (rows of a table that references a renamed table) → partial
    operations apply normally; the scan reports it as a diagnostic with its known false-positive source.
  - AS-47g Replayed-ledger baseline (a Draft the repair left `repaired` or `alreadyRepaired`): an exactly
    `{ all: true }` commit is `applied` with no `unrecordedStructureChange`; it publishes the repair migration, the
    new Head passes predicate (b), and a Head-synced replica applies the repair migration.
  - AS-47h Neither baseline (SQL fixture: the Draft schema matches neither the Head schema row nor the replayed
    schema after the pending migrations) → an exactly `{ all: true }` commit is `blocked`
    (`unrecordedStructureChange`).
  - AS-47i Repair with pending migrations for the table (after the stage-0 fix, the Draft holds a recorded pending
    migration of the damaged table that builds on the unrecorded change, for example a rename of the field the async
    migration added): the repair returns `repaired`; it writes the repair migration with the diff from the replayed
    schema to the Head schema row, places it before that pending migration and renumbers the pending migrations after
    it; the combined verification passes; an exactly `{ all: true }` commit is `applied`, the new Head passes predicate
    (b), and a Head-synced replica applies the repair migration and then the renumbered one. When the combined
    verification fails (SQL fixture of a pending migration the repair cannot precede), the repair returns
    `needsDraftStructureRevert` (`blockedByDependency` when the table is coupled to a damaged table that is not repaired
    in the same call), nothing is written, and the scan reports the same outcome.
- AS-48 Ledger attribution: a pending migration that cannot be attributed (SQL fixture), or a Draft schema history
  that does not extend the Head history → every preview, commit and revert is `blocked` (`ledgerInconsistent`).
- AS-49 Unledgered table (§6.10), with the lineage cases of [async-row-migration-v2] AM-46: a Head table with no
  `init` migration in the Head ledger (SQL fixture; and a project whose revisions have no migration table), an id
  removed and recreated with no `init` after the `remove` (SQL fixture), a lineage broken by an unattributable `rename`
  (SQL fixture), and a table created in the Draft with no pending `init` (SQL fixture) → every partial operation on it
  is `blocked` (`unledgeredTable`) and listing returns it in `refusedTables`; units of other tables apply; exactly
  `{ all: true }` and native commit and revert it as before. A unit of another table that needs a change of the
  unledgered table is `blocked` (`unledgeredTable`) too: the deletion of a row its Head references while its Draft
  references another, the revert of a created row its Draft references, the rename of a table it references. When
  its other side references the lost row as well, the source dangles and the blocker is `danglingInSource`. Not
  unledgered: a table created in the Draft with its pending `init` (AS-14), and a Head table recorded as `init A`,
  `rename A → B`, although no `init` names `B`. A failed `rename` taints the new id's slot: that table fails
  predicate (b) and is refused with `headSchemaInconsistent`.

### 13.5 REQ-001.BR-005

- AS-50 `all: true` commit of a Draft with data and structure changes (rename, add, remove, create, views) → Head and
  new Draft link exactly the table versions native `createRevision` links; ledger, content, schemas and views equal
  native.
- AS-51 `all: true` revert → the Draft links exactly the Head table versions as native `revertChanges`.
- AS-52 After an applied `all: true`, `hasChanges = false` even with content-equal versions in another table (it reads
  every table).
- AS-53 Native `createRevision` and `revertChanges` suites pass unchanged.
- AS-54 A Draft with only content-equal versions → `all: true` returns `empty` (documented, §3.8).

### 13.6 REQ-001.BR-001, REQ-001.BR-009 — listing, preview, freshness

- AS-60 `listChanges` lists every unit kind with public ids, `side: 'head'` where needed, the structure link as a
  UnitRef whose selector resolves to exactly that structure unit (also in a table that took over the id of a removed
  table), and a selector that previews exactly that unit; paging with the cursor; read-only.
- AS-60a Every listed structure unit carries its `structureChange`: an added, a removed and a type-changed field, a
  field of a nested object and a field of array items (the array's pointer), input and computed fields in code-point
  order; a moved field once as `moved` with `from`, also through a chain of moves and for every leaf of a moved
  object; a moved and retyped field, and a moved File rewritten inside, as `changed` with `from`; a field added where a
  moved field was as `added`; a move reverted inside the Draft not at all, while its values stay with the structure
  unit; a `replaced` table with its added, removed and changed fields; `created`, `removed` and `transient` tables with
  empty `fields`; a renamed table with a field change as `changed` with `previousTableId`.
- AS-60b A structure unit that a preview names as a required unit, as the `structure` of a deferred row, in `sample`
  or as the `unit` of a blocker, and that a refused commit or revert names in `required` or in a blocker, carries the
  `structureChange` the listing gives for that unit; over random Drafts, the `sample` of each listed selector holds
  the listed unit with its `structureChange` (AS-61).
- AS-60c Annotations: a changed default, description or title of a field at its Head pointer is `annotated` with its
  sorted `annotations`, also for an array replaced with annotated item fields or item object; an object whose own
  description changed is an `annotated` entry at its pointer beside the added or changed fields inside it; a field
  whose stored schema did not change is not reported; a moved field or object stays `moved` or `changed`; a referrer
  given a description after a rename of its referenced table is `annotated`, also when another table took the old id,
  while one pointed at that other table, or given a description between two renames, is `changed`; a replace that
  drops a field held inside a File, one that also adds a field, or a `$ref` switched and switched back rewrites; a
  `replaced` table and Head and Draft compared without a replay report no object; the values of an annotated field and
  of the fields below an annotated object stay with the structure unit and are committed and reverted with it.
- AS-61 Property over random Drafts: each listed selector alone previews one unit with no `unmatched` or
  `notSelectable`; the union of the listed selectors previews with the same status, counts and fingerprint as
  `all: true`, for commit and revert.
- AS-62 Preview and listing run in a `READ ONLY` transaction and change nothing in the database.
- AS-63 A selected row changed after preview → `stale`, nothing written; an unrelated row changed → applied; a value
  of a structure-bound field, a table rename or a views edit after preview → `stale`; a table rename after preview
  that hands the `schemaHash` of a selected `rowColumns`, `rowCreate`, `rowDelete` or `rowReplace` unit to the
  structure (§9.1) → `stale`, nothing written; a Draft schema change after preview of a table whose structures
  already differ, with a selected deleted row → `stale`, nothing written; a Draft schema change after the preview of a
  committed deletion → applied; another table changed → applied.
- AS-64 `includeRequired` without `expected` → validation error; a commit fingerprint does not pass a revert
  (`stale`, `changed` includes `operation`); an `expected` that is not a fingerprint → validation error; one
  unmatched selector (included or excluded) → `blocked`; nothing matched → `empty` with current ids; a repeated
  commit → `empty`, no revision; a malformed pointer or selector → validation error (§5.9); `includeRequired`,
  `expected` or `comment` of a wrong type → validation error before any transaction (§5.9).
- AS-65 Completeness properties over random Drafts with `publishedAt` edits, renames, creations, deletions,
  replacements, files and structure changes, each listed unit applied alone (with `includeRequired` and `expected`
  when its preview requires additions): (a) reverting them one by one until nothing is listed leaves the Draft equal
  to Head in every compared column, with `hasChanges = false`; (b) committing them one by one yields a Head equal to
  the original Draft (what native `createRevision` publishes), with nothing listed and `hasChanges = false`.
- AS-66 `listChanges` reads changed rows only of the tables a page lists, continues from the cursor's table, and with
  `tableId` lists and reads only that table; paging until `nextCursor = null` returns the same units as a full
  listing, also when a page is empty. Keyset paging inside one large table returns the same units, reads at most
  `pageSize` changed rows per page, and continues a row whose units did not fit; an unknown `tableId` or a malformed
  cursor is a validation error.
- AS-67 Required, deferred and blocking units carry exact selectors: adding each required unit's `selector` to the
  selection (also a Head-side unit addressed with `side: 'head'`) previews `ready` with no required units; the
  `unit` of a `requiredExcluded` blocker names the excluded unit and its `reason`.
- AS-68 Notifications: an applied commit calls the endpoint hook for X and for the new Draft after the transaction;
  an applied revert calls it for the Draft after the transaction; a rolled-back or refused attempt calls nothing.

### 13.7 Concurrency and limits (REQ-001.BR-003, REQ-001.BR-004)

- AS-70 Barrier races: a native write to an untouched table during planning is kept; a selected field changed during
  planning is committed with its latest value; two partial commits become consecutive revisions with one Head and one
  Draft; a native write during a revert is kept; a native structure write during a structure commit is kept.
- AS-71 Two concurrent operations: commits on different tables both apply; on the same rows one applies and the other
  is `empty`; a commit of some rows and a revert of others both apply.
- AS-72 (stage 0) Continuous native writers: with the write fence, commit applies within the attempt cap.
- AS-73 `estimate` matches the links written and rows merged (an upper bound when a merge collapses to an existing
  version); above `maxChangedRows` (of the affected tables) the plan is refused before the catalogue; `tooLarge` above
  the mixed-table limit and above the per-row-work limit for formulas and for files; an in-place revert copies no
  links.
- AS-74 Scoped reading: a one-field preview, commit and revert next to an unrelated table with more changed rows than
  the limit read only the affected table and apply; changed rows of tables connected by a foreign key count, also
  of a table that only a pending migration names as a foreign-key target, or that a table created and removed in the
  Draft referenced;
  `all: true` reads every table; an unread table with only content-equal versions keeps its Draft version. Property over
  random Drafts and selections (including `exclude`, commit and revert): the scoped plan equals the plan that reads
  every table (status, fingerprint, selected, applied, required, blockers, unmatched, deferred, estimate except
  `changedRows`, ledger, per-table outcomes, written rows and views). Benchmark: a one-field commit and revert next
  to a changed unrelated table of 200,000 rows are not refused and their time does not depend on that table.
- AS-75 Guard before work: the estimate runs before every closure assembly, and a refused plan assembles nothing;
  preview, listing, commit and revert run under the operation timeout, so a preview whose planning outlasts the
  default transaction timeout still returns; a Draft that grows past a limit after preview → `blocked` (`tooLarge`),
  not `stale`.
- AS-76 Defaults and logs: the limits default to 20,000, 2,000 and 100,000, the timeout to 180,000 ms and the attempt
  cap to 3; an invalid configured value (`many`, `0`, `-1`, `1e5`, `100_000`, `2000abc`, `2.5`) keeps its default with
  a warning; the effective values are logged at startup, each non-default one with its variable. A listing page, a
  preview, a commit and a revert each log one entry with the fields of §11.1 (exactly, for an applied commit and
  revert, a ready preview and a listing page); a commit that a native write made retry logs both attempts; a preview
  the changed-rows limit stopped logs `tooLarge` and the estimate; a branch without a migration table logs its refused
  tables; an attempt observer hears every attempt and the escalated ones; a failure logs `error` with its name and
  code at `warn` and is rethrown, without the plan of an earlier attempt; refused input (a selection, a comment, a
  listing page size) logs `attempts: 0`; a throwing logger changes nothing for the caller; no entry holds a row value
  or an error message.

### 13.8 API revision v2.0 (REQ-001.BR-001)

- AS-80 Selection vocabulary: `structures` with `{ tableId, side? }` objects and `rowRenames` select as `tables` and
  `renames` did; a bare string in `structures`, and the fields `tables` or `renames`, are validation errors; every
  selector a result returns (listed units, required, deferred, sample, blockers, causes) is `SelectionItems` with no
  `all` or `exclude`, and adding it to `exclude` excludes exactly that unit. Units have exactly the fields of their
  kind; a shared schema unit has `sharedSchemaId` and no `tableId`.
- AS-81 Code lists and exports: every code union of §5.11 and draft-reads-v1 §9 equals its runtime list
  (`SELECTOR_SIDES`, `STRUCTURE_TABLE_CHANGES`, `STRUCTURE_FIELD_CHANGES`, `REASON_SITE_KINDS`, `STALE_CHANGES`, …); the
  package exports the names of §5.10 and no partial-changes type named `TableChange`, `FieldChange`, `Blocker`,
  `Counts`, `Estimate`, `Deferred` or `Reason`.
- AS-82 Views follow the structure: a table with a schema change and a views edit lists one structure unit, with
  `structureChange.views: true`, and no views unit; committing the structure publishes the Draft views, reverting it
  restores the Head views, and the other units of the table stay; `views: [table]` requires the structure
  (`structureBoundData`, site `selector`); `exclude: { views: [table] }` excludes the structure; `views: [table]` of a
  table whose structure changed and whose views did not is unmatched, included or excluded; a table without a structure change lists its
  views edit as a views unit that commits and reverts alone.
- AS-83 No views combination is checked or migrated: over random Drafts with views edits and schema changes, every
  commit and revert writes the views document of the structure side (or of the views unit's side) unchanged; a Draft
  views document invalid for its own structure (SQL fixture) blocks a commit of its structure or views unit with
  `invalidViews`, also with exactly `{ all: true }`, and nothing is written; a commit of other units and a revert
  block nothing, and invalid Head views copied into the Draft unchanged block nothing under an unchanged structure but
  block a commit of a structure that changes.
- AS-84 Reason sites: each code arises at the site kinds of §5.7 with the listed fields: `referencedRowMissing` at a
  `row` site with the referring field as `path` and `references` of kind `row` (the referenced table as units address
  it, the id the reference holds), also for a reference that a structure brings wholesale and for an unchanged
  referrer of a lost id; a schema reference at a `schema` site with `references` of kind `table`; a ledger step at a
  `migration` site with its `migrationId` and the ledger's ids, also for a table created and removed in the Draft; a
  row id collision at a `rowId` site; a table id collision at a `tableId` site, with `migrationId` at a migration's
  step; the selection codes at a `selector` site with no `cause`.
- AS-85 Causes: every closure reason caused by an applied unit carries `cause` with that unit (a DescribedUnitRef with
  its exact selector) and the role of §5.7, including the `occupant` at a ledger step (the example of §5.7: a table
  created at `x` and renamed to `y`, another created at `x`, the second committed alone), the `remover` at a ledger
  step (the `notes` / `links` example of §5.7) and the reverted removal as `occupant`; the `cause` of a result names its
  unit as the listing describes it; the `reason` of a `requiredExcluded` blocker carries the same `cause`.
- AS-86 Deferred values: a created row committed without its table's structure lists in `defaulted` each Head input
  field with the value the commit writes, equal to the value in the written row (a declared default, and a type default
  after a native schema update); fields the Head schema lacks or computes are in `omitted` as `{ path }`; a moved field
  is in both.
- AS-87 Stopped plans: a preview stopped by `maxChangedRows`, and one stopped by a mixed-table or per-row-work limit in
  the closure, return `planned: false`, `fingerprint`, `counts` and `unmatched` as `null`, empty `required`,
  `deferred`, `sample` and `coverage`, the `tooLarge` blockers (with `migrationInProgress` while an async migration
  is active) and the estimate measured up to the stop; a commit or revert stopped by a limit is `blocked` with
  `planned: false`, empty `required` and no `unmatched`. A planned result never has a `null` field.
- AS-88 Counts and coverage: `counts` has `selected` and `required` only, and `sample` holds the first
  `min(20, selected + required)` applied units; `coverage` lists every user table with an applied unit: `structure`
  and `views` present exactly when the table has that unit, `rows` equal to the number of distinct row selectors of the
  table's row and field units in the listing (and to `tableData.rows` of the Draft reads, draft-reads-v1 DR-05),
  `appliedRows = rows` when `tableData: [table]` is selected, a row
  with one of its two units selected counted in `partlyAppliedRows`, required additions counted as applied, and two
  entries (one with `side: 'head'`) when a rename took over the id of a removed table; no entry for transient
  structure units or shared schemas.
- AS-89 Applied results: `draftHasChanges` is `false` after a commit or revert that leaves no difference and `true`
  while another unit or a content-equal version of an unread table remains, equal to the Draft's stored `hasChanges`;
  `renumberedMigrations` lists the renumbered ids; no result has `remaining` or `unreadTables`.
- AS-90 Stale causes: a partial commit of another table after the preview → `changed: ['revisions']`; a new required
  addition after the preview → `['units']`; a selected field edited again after the preview → `['content']`, while an
  edit of another field of a row selected with `rows` adds a unit → `['units']`; the fingerprint
  of the other operation → includes `operation`; a well-formed fingerprint of another version → `['version']`; every
  `stale` carries the current ids and `unmatched`, which names a kept selector that no longer matches.
- AS-91 Fingerprints: equal plans give equal fingerprints across calls and engine instances; a malformed `expected`
  (no `pcf<n>.` prefix, a body that is not base64url, a `pcf2.` payload that is not a five-element array of strings)
  → validation error before any transaction; `pcf3.` with any base64url body → `stale`, `changed: ['version']`.
- AS-92 Facade: `changes.list`, `preview`, `commit`, `revert`, `tableChanges`, `rowChanges` and `summary` on the
  engine facade behave as these specifications say, through the package exports (e2e).

## 14. Test strategy

- **Oracle.** `all: true` against native `createRevision` and `revertChanges`: exact table versions, ledger, content,
  schemas and views, with data and structure changes.
- **Committed-versions guard**, registered in every suite and checked before and after every operation and test:
  every table and row version linked by a non-Draft revision is readonly and byte-identical to its first observation
  (including link sets and ordered blob links), and no committed table version holds two rows with one id. A test of a
  known native defect may accept that one row explicitly.
- **Property sequences** with a Head-synced replica: random native edits, native and partial commits and reverts;
  every step and the final `all: true` asserted; the renumbering invariant after every step.
- **Listing and completeness properties**: listed selectors round-trip; the union equals `all: true`; unit-by-unit
  revert reaches Head and unit-by-unit commit reaches the original Draft (AS-65); the scoped plan equals the plan of a
  reference mode that reads every table with the same affected set (AS-74). The generator must place `publishedAt`
  edits on rows that are not also renamed or replaced, before the field is removed; otherwise the property passes
  without exercising them (seen in the PoC). Each property asserts that every unit kind of §3.4 appeared at least
  once across its seeds, so a generator gap cannot hide a kind.
- **Column classification test** (§3.1): every field of the `Row` and `Table` models is classified as compared or
  not.
- **Races** with barriers for each conflict pair, and stress runs with continuous writers (with and without the
  fence).
- **Mutation controls** kept as patches; each must turn the suites red. Shown in the PoC (34 across M4–M5, of which 30
  apply to the final code): no row dependency checks; no renumbering; no table dependencies (with and without ledger
  validation); fingerprint without system rows, without Draft rows, without the operation; `includeRequired` without
  `expected` allowed; unmatched selectors ignored; files registered before the relink; mutable merged Head rows; merges
  without formula recomputation; no structure binding of changed foreign-key values; transient units not grouped;
  read-write planning transaction; listing without `side: 'head'`. Four more were shown against the M4 code only and
  must be re-created for the final code: ReadCommitted instead of Serializable, no size guard, every structure commit
  blocked, Draft keeping versions of tables without units. Added in M5 (patch names): `reader-without-row-columns` (no
  `publishedAt`, `meta`, `schemaHash` in the reader and catalogue), `reader-without-row-columns-and-relink-check` (the
  same without the content check; reproduces the lost `publishedAt` edit), `fingerprint-without-row-columns`,
  `estimate-after-assembly`, `per-row-work-without-files`, `stale-before-too-large`,
  `planning-under-transaction-timeout`, `rename-selector-as-row-with-field-exclusions`, `scope-without-foreign-keys`,
  `limit-counts-whole-draft`, `listing-reads-all-tables`, `unread-tables-relinked`, `guard-forgets-every-observation`
  and `no-row-lock-on-structure-commit` (no readonly locking on the structure-commit path).
- **Controls for guarantees that exist only in this SPEC** (one each; the PoC built none): the Head schema check off
  (AS-47a–b apply); the check skipped for a repaired but unpublished table (AS-47c applies where it must refuse);
  refused tables listed with units (AS-47d); the check applied to exactly `{ all: true }` (AS-47e native equivalence
  fails) and not applied to `{ all: true, exclude }` (AS-47e); "recorded" for a damaged table from one baseline only
  (AS-47e or AS-47g blocked); "recorded" accepted for a damaged table although neither baseline matches (AS-47h
  applies where it must be blocked); the repair migration appended after the table's pending migrations, or the patch
  diffed against the Draft schema (AS-47i replay fails); predicate (a) used for the refusal (AS-47f blocked);
  unledgered tables not refused (AS-49 applies); the closure without ledger dependencies (AS-43's ledger cases are
  `blocked` with `ledgerInconsistent`); listing without keyset paging (a page reads a whole table); no deadline
  enforcement (the deadline race, `transaction_timeout` or the checkpoint limits); COMMIT started after the deadline;
  the engine-wide retry loop instead of the operation's attempt cap; no write fence; required, deferred and blocking
  units without exact selectors;
  endpoint notification inside the transaction or missing; unattributable migrations ignored (AS-48); published-at
  ownership by the first of several leaves; an unclassified model column; a writer that locks by scanning the table (a
  cost assertion on locked rows).
- **Benchmarks** fail the run on any check and verify every Head and Draft row in SQL: data, `hash`, `schemaHash`,
  formula consistency, `readonly` of rows and tables, no dangling foreign keys, file links and project bytes; at least
  3 runs per cell; the estimate is compared with the links and rows written. A scoped
  benchmark adds a changed unrelated table and checks that its versions stay untouched.
- **Gaps to close in implementation:** JSON Pointer escapes (`~0`, `~1`); applied reverts of swaps and reused ids;
  Head-id fallback after a concurrent rename; races with
  files; closures through several referrer tables; AS-31's "referenced by an unchanged row → `danglingInSource`";
  a `RowPublishedAt` inside an array and several `RowPublishedAt` fields in one schema (§3.1); scoped reading with
  large foreign-key-connected tables; keyset paging inside a table (§5.2); the Head schema check and repair (§6.10,
  AS-47); exact selectors on required and blocking units (§5.1); post-commit notification (§6.13); the deadline and
  attempt loop (§8.1). The PoC tested none of these; it did not build keyset paging,
  the Head schema check, exact selectors on required and blocking units, post-commit notification, the deadline or
  the attempt loop, and it did not measure the structure-digest cost.

**PoC evidence** (PoC v2, sandbox of 2 CPU and 4 GB; summary in
[research/partial-changes-poc-v2.md](../research/partial-changes-poc-v2.md), code on
`c86e86c`, tag `archive/partial-changes-poc-v2`): 256 scenarios green
after M5 with `tsc` and lint clean, re-run independently; 34 mutation controls shown across M4–M5, 30 of them
applying to the final code. M5 proved the completeness properties
both ways for 6 seeds each (the commit property was red before the fix, with the `publishedAt` edit lost); the
scoped-vs-full property for 6 seeds × 4 selections (broken by `scope-without-foreign-keys`); the scoped benchmark
(one-field commit 58 ms and revert 48 ms in the transaction next to 200,000 changed unrelated rows, medians of 3; 51 ms
and 38 ms without them; the same commit reading every table refused with `tooLarge` after 2.2 s); the guard before
assembly, the per-row work with files and the operation timeout; and all M3/M4 benchmarks asserting at 10k.

## 15. Mapping from the archived v1 contract

Archived v1 (tag `archive/draft-changes-v1`): browse operations, `planDraftChanges`, `draftChangesPlanDetails`,
`executeDraftChanges`.

| v1 capability | Status | In this specification |
| --- | --- | --- |
| Browse summary, changed tables, rows, details, pagination | Replaced | `listChanges` (paged units with exact selectors, read table by table, `tableId` filter, no total) and the Draft reads ([draft-reads-v1](draft-reads-v1.spec.md)); native `revisionChanges`, `tableChanges`, `rowChanges` stay for history and compare. |
| `planDraftChanges` (commit, discard) | Replaced | `previewChanges` (commit, revert), read-only. |
| `draftChangesPlanDetails` (paged effect groups) | Dropped | Required units with reasons, `deferred`, `renumberedMigrations`, `estimate`, `sample`, `coverage`. |
| `executeDraftChanges(planToken, requestId, requiredAcknowledgmentToken, message)` | Replaced | `commitChanges` / `revertChanges` with the selection, `includeRequired` + `expected`, `comment`. |
| Selectors `all`, `rows` | Covered | `all`, `rows` (+ `side`). |
| Selector `table` (rows all or none) | Replaced | `structures`, `tableData`, `views`. |
| Selector `rowFields` (JSON Pointer) | Covered | `fields`. |
| Selector `schemaFields` | Replaced, coarser (required by REQ-001.BR-007) | `structures`: one structure unit per table. |
| Selector `change(ref)`, exact refs | Replaced | Public ids, `side: 'head'`, `rowRenames`, `rowColumns`; transient incarnations grouped. |
| `exclude` | Covered | Widens to the containing atomic or whole-row unit; a needed excluded unit blocks. |
| Views per component | Replaced, coarser | Whole views document; with the structure when the table's structure changed (§3.6). |
| Shared schema facet | Covered for independent changes | `sharedSchemas`. |
| Plan statuses ready / confirmationRequired / blocked / empty | Replaced | ready / required / blocked / empty. |
| Execution statuses applied / replayed / stalePlan / blocked | Replaced | applied / required / blocked / stale / empty; a replay is `empty` with the ids. |
| Counts selected / automatic / required / remaining | Replaced | selected / required, per-table `coverage`, `draftHasChanges`; what stays comes from the Draft reads; formula values and file links are not units. |
| Structured blockers | Covered | Richer codes (§5.8). |
| Result ids and counts | Covered | Previous Head (commit), Head, Draft, applied, `draftHasChanges`. |
| JSON Pointer; formula outputs not selectable; planning writes nothing; atomic execution incl. files and history | Covered | |
| Atomic arrays, row creation and deletion | Changed | `required` (`atomicValue`, `wholeRowUnit`) where v1 blocked. |
| Ambiguous selector blocked | Covered | `unmatchedSelector`. |
| Loser of two concurrent commits is stale | Changed | Only with `expected`; otherwise the loser re-plans. |
| Plan token without repeating the selection | Dropped | The caller repeats the selection with `expected`. |
| `requestId` idempotency | Replaced | `empty` on repeat; `expected`. |
| Confirmation before a destructive schema discard | Dropped | Preview with `required` and `deferred`. |
| Commit only the deletion of a reused id | Dropped | `rowReplace` is one unit. |

## 16. Out of scope

- Change sets, scheduling and UI (REQ-001.BR-009).
- The dependency "shared schema → tables using it" (tables cannot reference shared schemas yet).
- Replicas synced from Draft exports.
- A staged background job above the limits; delta table versions (ADR-001).
- Versioning engine v2 storage ([ADR-0046]); the contract of this specification applies unchanged.
- A count of what stays in the Draft in operation results (the Draft reads give it, [draft-reads-v1] §6) and a
  content-equality pass over unread tables (only `all: true` normalises them).
- For a later minor version, additive ([ADR-002] Boundaries): structured blocker details, item and unit keys, a Draft
  read token, a pageable resolved plan, a light table-options query, reasons for `omitted` deferred paths (a field of
  their objects).
- Rewriting committed history damaged by the async-migration defect (it would need its own ADR; not planned), and the
  design of the async-migration fix itself (its own stage-0 design, §12).
- When data-level foreign keys ([ADR-0025]) or time-travel foreign keys
  ([ADR-0032]) are implemented, the read scope (§6.2) and the dependency
  closure (§6.6) must follow those references too: the proof that schema foreign keys are enough to scope reading
  (AS-74) no longer holds for them, and until the rules are extended such tables must be read with every table that
  can reference them.

## 17. Open questions

1. **Delivery order** — closed: stage 0 (native fixes), then partial revert, data commit, structure commit,
   API/CLI/MCP; stages 1–3 may be developed alongside stage 0, but no partial operation is released before every
   stage-0 must item and its release gate (§12). Confirmed on 2026-10-31.
2. **Partial revert during an active async migration after stage 0.** Native revert cancels the branch migrations and
   notifies endpoints; partial revert refuses. Proposal: a partial revert that applies the structure unit of the
   migrating table cancels that migration as native revert does; any other partial operation keeps refusing with
   `MigrationLocked`.
3. **Write fence parameters** — closed: native `createRevision` and native revert escalate after 2 consecutive
   serialization failures, so the third attempt runs under the exclusive holder; the holder waits at most half of
   `TRANSACTION_TIMEOUT`, then the operation fails with `BRANCH_WRITE_FENCED`; the holder stays open until the
   protected transaction ends; native `createRevision` keeps `TRANSACTION_TIMEOUT` and does not share
   `PARTIAL_CHANGES_OPERATION_TIMEOUT_MS`; no new settings (§8.4). Decided on 2026-11-01.
4. **False positives of predicate (a)** — closed: the refusal uses predicate (b) only; predicate (a) is a scan
   diagnostic with its known false-positive sources; table rename is not changed; unledgered tables are refused with
   `unledgeredTable`, and their ledger backfill is a stage-0 design item (§6.10, §12); specified on 2026-11-10 in
   [schema-ledger-backfill-v1](schema-ledger-backfill-v1.spec.md).

## Changelog

### Version 2.0 (2026-11-10)

The public API revision of [ADR-002], before the API is first released. It includes the changes the Draft changes PoC
made on its branch as versions 1.4–1.7, which never reached master. Versions 1.4–1.7 are not separate releases.

Unit model and algorithm:

- §3.4, §3.5, §3.6, §4.3, §6.3, §6.6, §6.7, §6.9: views follow the structure. A table with a structure unit has no
  views unit; its views document, independent edits included, belongs to the structure unit, and `views` of such a
  table requires it (`structureBoundData`). The closure's views fit check, the migration of the Head views document
  through the pending history, the reason `viewsDoNotFitStructure` and the role `counterpart` are removed;
  `invalidViews` comes from target validation of the Draft documents a commit publishes (§6.9 step 5).
- §5.2: structure descriptions report `annotated` fields with their `annotations` (`ANNOTATION_KEYWORDS`), and an
  object whose own annotations changed as an `annotated` entry at its pointer (PoC 1.4–1.6); a `replace` counts as
  annotating by what native holds before and after it, serialized and with File contents, with foreign keys compared by
  the identity of the referenced table; `StructureChange.views` says that the unit carries a views change.

Selection (§4.1, §4.2, §4.5, §5.1):

- `tables` → `structures`, objects only (`{ tableId, side? }`); `renames` → `rowRenames`. Every returned selector is
  `SelectionItems`; `unmatched` is `UnmatchedSelectors`. `views` of a table with a structure unit requires it, or is
  unmatched when the table's views did not change, and excluding it excludes the structure.
- `Unit` is discriminated by `kind`, with exactly the fields of its kind; a shared schema unit has `sharedSchemaId`
  instead of a `tableId` carrying that id.

Results (§5.1, §5.3–§5.7, §5.11, §5.12):

- `Reason` → `RequiredReason { code, because, site, references?, cause? }`. `site` has a `kind` (`selector`, `row`,
  `schema`, `migration`, `rowId`, `tableId`) that fixes its meaning; `references` names the referenced row or table;
  `cause { unit, role }` replaces the PoC's `by` / `byRole` (PoC 1.5–1.6); roles `referrer`, `remover`, `taker`,
  `occupant`.
- `Deferred` → `DeferredRow` with `defaulted: { path, value }[]` and `omitted: { path }[]` (PoC 1.5–1.6 split
  `paths`; v2.0 adds the values and makes the omitted paths objects).
- Preview: `planned`; when a limit stopped the plan, `fingerprint`, `counts` and `unmatched` are `null` instead of
  `''`, zeros and `{}`. `counts` drops `remaining`; `unreadTables` is removed; `coverage` (`TableCoverage[]`) is new;
  `sample` holds the first `min(20, selected + required)` applied units.
- Commit and revert: `remaining` is removed and `draftHasChanges` added; `renumbered` → `renumberedMigrations`;
  `blocked` carries `planned`; `stale` carries `changed`, the current ids and `unmatched` (§9.2).

Fingerprint (§9.1, §9.2, §5.9): four parts (operation, revisions, units, content) behind a version prefix, so
`stale` says which changed (`version` for a fingerprint of other rules); an `expected` the engine cannot decode is a
validation error.

Names (§5.10, §5.11): `Branch` → `ChangesBranch`, `Side` → `SelectorSide` (`HEAD_QUALIFIERS` → `SELECTOR_SIDES`),
`TableChange` → `StructureTableChange` (`TABLE_CHANGES` → `STRUCTURE_TABLE_CHANGES`), `FieldChange` →
`StructureFieldChange` (`FIELD_CHANGES` → `STRUCTURE_FIELD_CHANGES`), `Blocker` → `PlanBlocker`, `Counts` →
`PlanCounts`, `Estimate` → `PlanEstimate`; new lists `REASON_SITE_KINDS`, `STALE_CHANGES`. Transports type every
engine value and keep one spelling per code (§5.10); the transport contract names the three reads. The facade's
`changes` namespace also exposes the Draft reads ([draft-reads-v1](draft-reads-v1.spec.md); the PoC's Draft diff,
1.7).

Limits and logs (§9.1, §11, §11.1, §12): the changed-rows, per-row-work and mixed-table-link limits default to 20,000,
2,000 and 100,000 instead of 100,000, 10,000 and 250,000, with the worst case each keeps; the timeout and the attempt
cap stay; a setting must be a whole decimal integer within bounds (the reader is shared with the native
`TRANSACTION_*` settings, which become as strict: `15000ms` or `+15000` now keep the default with a warning); the
effective settings are logged at startup; every listing page, preview, commit and revert logs one entry (§11.1); the
structure digest is measured; the release gate takes these instead of a re-measurement on production-like hardware.

Scenarios: AS-10, AS-17, AS-19, AS-45, AS-64 reworded; AS-60c, AS-76 and §13.8 (AS-80 – AS-92) added.

### Version 1.3 (2026-11-03)

Structure units in results:

- §5.1, §5.2, §5.3, §5.11: preview and apply results describe the structure units they name as the listing does:
  `required`, `deferred`, `sample` and blocker units are DescribedUnitRefs, which carry `structureChange` on structure
  units, so a caller explains a preview without listing the Draft. ListedUnit is a DescribedUnitRef plus `structure`,
  with its fields unchanged.
- §13.6: AS-60b covers `structureChange` in preview and apply results.

Moved fields and replaced tables in `structureChange`:

- §5.2, §5.11: `ChangedField` gains `from`, and `FIELD_CHANGES` gains `moved` (appended). A Draft field whose
  values came from a Head field through pending `move` patches is reported once at its Draft pointer, as `moved` or,
  when its schema or values also changed, `changed`, with the Head pointer as `from`; before, it read as `removed` at
  the Head pointer and `added` at the Draft pointer. A field added where a moved field was is `added`, and a move
  reverted inside the Draft is not reported. Patch paths are read against the schema each patch applies to, so a patch
  inside an array or File rewrites that whole value; within one migration that schema is the one native holds between
  the patches, not its serialized form. When the pending patches do not replay, `fields` compares the Head and Draft
  leaves by pointer, without `moved` or `from`. Which fields are structure-bound does not change.
- §5.2: a `replaced` table lists its fields: the leaves of the removed Head table against those of the Draft table
  created at its id, as `added`, `removed` or `changed`. Before, its `fields` was empty.
- §13.6: AS-60a covers moves and replaced tables.

Patches inside a File:

- §3.3: a pending patch inside a File schema binds the File field to the structure unit, as a patch inside array
  `items` binds the array. Patch paths are mapped by the replay that describes the structure (§5.2), which reads each
  path against the schema its patch applies to. Before, a path such as `/properties/cover/properties/fileName` was
  mapped by its `properties` segments to `/cover/fileName`, which touches no leaf: `/cover` stayed unchanged, so a File
  value that a row changed in the Draft was a `field` unit while `structureChange` reported `/cover` as `changed`.
  Paths into array `items` and object fields bind the same leaves as before. When the pending patches do not replay,
  paths are still mapped by their `properties` segments, and a path inside a File touches no leaf.

Input types:

- §5.9, §13.6: `includeRequired` other than a boolean, `expected` other than a non-empty string and `comment` other
  than a string are validation errors before any transaction. Before, their types were not checked: a non-boolean
  `includeRequired` such as `'false'` applied required additions without `expected`, and an empty `expected` returned
  `stale`.

Ownership in the fingerprint:

- §9.1: the fingerprint of a `rowColumns` unit covers the columns it owns, and the fingerprint of a `rowCreate`,
  `rowDelete` or `rowReplace` unit that moves a row into the other structure covers the structures it moves the row
  between. Before, a row unit contributed its key and its row versions only. A table rename after the preview hands
  `schemaHash` to the structure unit without changing a row version, so the fingerprint stayed the same and a commit
  with `expected` applied: Head got the selected `meta` but not the previewed `schemaHash`, and a created, deleted or
  replaced row was written with the hash of the target schema. Likewise, a revert with `expected` restored a deleted
  row into a Draft structure that had changed after the preview. §9.1 also states that the `schemaHash` of a written
  row follows its target table's schema at apply time and that values generated by the apply are not fixed by the
  preview.
- §13.6: AS-63 covers these renames and Draft schema changes, and a committed deletion that stays applicable.

### Version 1.2 (2026-11-02)

Listing of structure units:

- §5.2, §5.11: `ListedUnit.structure` is a UnitRef with `side` and a selector that resolves to exactly that structure
  unit, instead of a plain Unit.
- §5.2, §5.11: a listed structure unit carries `structureChange`: whether its table is created, removed, replaced,
  transient or changed, and for a changed table every changed leaf as a data JSON Pointer marked `added`, `removed` or
  `changed`. Only the listing carries it; unit identities, selectors, preview results and the fingerprint do not
  change.
- §13.6: AS-60 covers the structure UnitRef; AS-60a covers `structureChange`.

Optional inputs:

- §5, §5.9, §5.11: an optional input field of the four operations given as `null` is treated as absent, at any depth
  of the input and its selection; required fields stay required, and a field the object does not have stays malformed
  when given as `null`. The input types accept `null` in exactly those fields (`SelectionInput`). GraphQL clients
  send `null` for omitted optional arguments, which the engine took as values (`cursor: null` was a malformed cursor,
  `expected: null` made a commit `stale`).

Code lists:

- §5.10: every code union of the operations has one runtime list next to its type, and the type is derived from it,
  so a transport builds its enums from the engine instead of a hand-kept copy that drifts.

### Version 1.1 (2026-10-31)

Follow-up of [async-row-migration-v2]:

- §3.3: a patch inside an atomic leaf's schema touches that leaf (clarification).
- §5.8, §6.9, §6.10: the ledger replay runs an identity pass and a schema pass; "unledgered" is a property of the
  table's lineage, not of a literal `init`; a failing step taints only the slots it reaches.
- §8.3: the fixed async migration; native revert and `abortMigration` reject `SWAPPING`.
- §8.4: the `exclusiveHeld` admission mode; the async start and swap and the repair take the fence shared;
  `applyMigrations` takes no exclusive fence; native writers wait for an exclusive holder at most half of
  `TRANSACTION_TIMEOUT`.
- §10.3: imported async updates keep their source ids; async migrations in flight at upgrade are cancelled.
- §12: #85–#92 marked landed; the `applyMigrations` item, the scan and the repair point to async-row-migration-v2;
  ledger backfill and row remediation are decided with the scan results.
- §13.4: AS-47c, AS-47g and AS-47i use the repair outcomes; AS-49 covers the lineage cases.

Write fence, part 2:

- §8.4, §17 question 3: escalation after 2 consecutive serialization failures; an escalated attempt takes one of the
  escalation slots (half of the connection pool) before any connection, then opens the holder before its first
  statement; the slot wait and the lock wait share half of `TRANSACTION_TIMEOUT`; the holder stays open until the
  attempt has committed or rolled back, with its own timeout a 30 s grace beyond the attempt's; native revert takes
  the fence shared before it escalates; no new settings.

Deadline enforcement:

- §8.1, §11, §14: the operation's callback settles at the deadline, and Prisma's own timeout stays a fixed grace beyond
  it; `transaction_timeout` is re-armed in each transaction on PostgreSQL 17; older servers renew `statement_timeout`
  and `idle_in_transaction_session_timeout` at deadline checkpoints instead of per-statement budgets; COMMIT never
  starts after the deadline; an error counts as the timeout only with evidence, and `P2028` never does.

Idempotency:

- §9.2: "never applied twice" holds for requests with `expected`; a request without `expected` re-resolves its
  selection against the current state on every call and can address a different unit when ids are reused
  (clarification).

Ledger dependencies:

- §5.7, §6.6, §13.4, §14: the closure replays the resulting ledgers and requires, for a pending migration that needs a
  table id at its own step, the unit that provides the id (commit) or the unit of the step (revert, remaining Draft); a
  referenced id must resolve to the same lineage as in the Draft ledger, and what validation tolerates adds nothing;
  AS-43 covers it, and the AS-65 generator no longer avoids such steps.

Listing:

- §5.2, §11: a page stops after reading `pageSize` changed row ids, each with at most two row version pairs, because
  a changed row can yield no unit; the cursor carries the row to resume from; the per-page cost of the link anti-join
  is stated with measurements.

Structure commit (delivery stage 3):

- §5.8, §5.11: the temporary `structureCommitUnavailable` blocker is removed; a commit applies structure units.
- §3.1, §6.7: a merged row takes `schemaHash` from the other side when the `rowColumns` unit that owns it takes the
  other side, as `publishedAt` and `meta` do, else the hash of the target schema; native `createRevision` publishes
  a Draft row's `schemaHash` as it is, also one a native rename of a referenced table left stale.
- §6.2, §13.7 (AS-74): the read scope also follows the foreign-key targets that pending migrations name, through
  pending renames and from tables created and removed in the Draft, so every table a ledger dependency (§6.6) can
  require is read; a plan that applies a unit of a changed table it did not read is an internal error.

### Version 1 (2026-10-22)

- Initial version, based on PoC v2 (M1–M5). Accepted on 2026-10-31.

[REQ-001.BR-001]: ../requirements/REQ-001-partial-commit-and-revert.md
[REQ-001.BR-002]: ../requirements/REQ-001-partial-commit-and-revert.md
[REQ-001.BR-003]: ../requirements/REQ-001-partial-commit-and-revert.md
[REQ-001.BR-004]: ../requirements/REQ-001-partial-commit-and-revert.md
[REQ-001.BR-005]: ../requirements/REQ-001-partial-commit-and-revert.md
[REQ-001.BR-007]: ../requirements/REQ-001-partial-commit-and-revert.md
[REQ-001.BR-009]: ../requirements/REQ-001-partial-commit-and-revert.md
[ADR-0003]: https://github.com/revisium/architecture/blob/master/adr/ADR-0003-versioning-architecture.md
[ADR-0025]: https://github.com/revisium/architecture/blob/master/adr/ADR-0025-polymorphic-foreign-keys.md
[ADR-0029]: https://github.com/revisium/architecture/blob/master/adr/ADR-0029-unique-constraints.md
[ADR-0032]: https://github.com/revisium/architecture/blob/master/adr/ADR-0032-time-travel-foreign-keys.md
[ADR-0046]: https://github.com/revisium/architecture/blob/master/adr/ADR-0046-versioning-engine-v2-cow.md
[async-row-migration-v1]: https://github.com/revisium/architecture/blob/master/specs/async-row-migration-v1.spec.md
[async-row-migration-v2]: async-row-migration-v2.spec.md
[audit-logs-v1]: https://github.com/revisium/architecture/blob/master/specs/audit-logs-v1.spec.md
[endpoint-v1]: https://github.com/revisium/architecture/blob/master/specs/endpoint-v1.spec.md
[permission-system-v1]: https://github.com/revisium/architecture/blob/master/specs/permission-system-v1.spec.md
[ADR-002]: ../adr/ADR-002-draft-reads-and-public-changes-api.md
[draft-reads-v1]: draft-reads-v1.spec.md
