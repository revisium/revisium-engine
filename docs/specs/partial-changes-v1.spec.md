# Partial Changes Specification v1

## Overview

| Property | Value |
| --- | --- |
| Version | 1 |
| Status | Accepted |
| Date | 2026-10-22 |
| Parent ADR | [ADR-001](../adr/ADR-001-partial-commit-and-revert.md) |
| Requirements | [REQ-001](../requirements/REQ-001-partial-commit-and-revert.md): REQ-001.BR-001 … REQ-001.BR-009; REQ-001.BR-006 and REQ-001.BR-008 are withdrawn |
| Evidence | [research/partial-changes-poc-v2.md](../research/partial-changes-poc-v2.md) (PoC v2, `c86e86c`, tag `archive/partial-changes-poc-v2`) |

This specification defines partial commit and partial revert of Draft changes in revisium-engine: the operations
`listChanges`, `previewChanges`, `commitChanges` and `revertChanges`, the unit and selection model, the assembly
algorithm, storage effects, transactions, freshness, migration history, limits and the native prerequisites. It
applies to the current versioning engine ([ADR-0003]). The design was proven by PoC v2 (milestones M1–M5); §14
summarises the evidence.

**Engine background** ([ADR-0003]). A revision links table versions and
a table version links row versions (both many-to-many); tables and rows carry `versionId`, `createdId` and `id`.
Committed versions are readonly and shared; a Draft edit copies the version it changes first. Schemas with their
history, the migration ledger, views and shared schemas are rows of system tables in the same revision. Native
commit turns the Draft revision into Head and creates a child Draft linking the same table versions; native revert
links the Head table versions into the Draft. Native row and schema writers run Serializable and take no row locks;
views writes and async-migration copy batches do not run Serializable (§12).

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
| [REQ-001.BR-005] | Whole-Draft commit and revert work as before. | Native operations unchanged; exactly `{ all: true }` equals native commit and revert, also on a damaged project (§6.10, §13.5). |
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
| `schemaHash` | only when the structure is unchanged | `rowColumns` (defensive: native writers set the current schema hash on every write); when the structure differs it follows the structure |

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
   (both `from` and `path` of a move) at the leaf's pointer or above it.

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
| `rowColumns` | A row on both sides differs in a column no field or structure unit owns (§3.1): `publishedAt` when the Draft schema has no published-at field, `meta`, or `schemaHash` under an unchanged structure. | `tableId`, `rowId` (Draft id, else Head id), `columns` (the differing columns it owns) | Those columns of the row, as one unit. |
| `structure` | The table is created, removed or renamed; its schema row differs in data or history; or pending migrations are attributed to it. | `tableId` (Draft id, else Head id), `previousTableId` (Head id when renamed) | See §3.5. |
| `views` | The Draft views document differs from the Head document migrated through the pending schema history. | `tableId` (Draft id) | The whole views document of the table. |
| `sharedSchema` | A row of the shared schemas table differs. | `tableId` carries the shared schema id | That shared schema. |

### 3.5 Structure unit

One unit per table identity. It covers:

- the table's existence and public id (create, remove, rename);
- its schema row with the schema history;
- the pending migrations attributed to the table (§10.1);
- the values of changed fields in every row of the table, including `publishedAt` when the published-at field is new
  or changed, and `schemaHash` when the structure differs;
- the views changes that follow automatically from its migrations;
- all rows of a created or removed table ("committed whole");
- the histories of tables created and removed inside the Draft that used one of its ids.

A removed and re-created table id is one structure unit. Tables created and removed inside the Draft (transient)
leave only pending migrations: their histories are grouped by the table ids they used; a group that shares an id
with a table that has a structure unit joins that unit, otherwise the group is one structure unit addressed by its
id.

### 3.6 Views and shared schemas

- The views unit holds only independent edits: when the Draft document equals the Head document migrated through
  the pending history, the table has no views unit and the migrated document follows the structure.
- Shared schemas are independent units. Tables cannot reference shared schemas in the engine yet, so there is no
  dependency between a shared schema and tables (out of scope, §16).

### 3.7 Identities and public ids

- **Replace.** A deleted and re-created row id is one `rowReplace` unit; a removed and re-created table id is one
  structure unit.
- **Rename.** A row rename is a `rowRename` unit, selected alone by `renames`; its field and row-column edits are
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

Every field is optional. The selection is the union of all items minus the exclusions.

| Field | Type | Selects |
| --- | --- | --- |
| `all` | boolean | Every unit of the Draft. |
| `tables` | array of `string` or `{ tableId: string; side?: 'head' }` | The structure unit of each table. |
| `tableData` | `string[]` | Every row unit (`rowCreate`, `rowDelete`, `rowReplace`, `rowRename`, `rowColumns`) and `field` unit of each table that exists on both sides. |
| `views` | `string[]` | The views unit of each table. |
| `sharedSchemas` | `string[]` | The unit of each shared schema id. |
| `rows` | `{ tableId: string; rowId: string; side?: 'head' }[]` | Every unit of each row: existence or replace, rename, fields, `rowColumns`. |
| `renames` | `{ tableId: string; rowId: string; side?: 'head' }[]` | Only the `rowRename` unit of each row; field edits of that row, including later ones, are not selected. |
| `rowColumns` | `{ tableId: string; rowId: string; side?: 'head' }[]` | Only the `rowColumns` unit of each row. |
| `fields` | `{ tableId: string; rowId: string; path: string }[]` | The field units at or below each JSON Pointer. |
| `exclude` | the item fields above, without `all` and `exclude` | Units removed from the selection. |

### 4.2 Id resolution

- A table id resolves to the Draft table with that id, else the Head table with that id; for `tables` only, else a
  transient structure unit with that id. With `side: 'head'` only Head tables are searched.
- A row id (`rows`, `renames`, `rowColumns`, `fields`) resolves inside the resolved table to the Draft row with that
  id, else the Head row with that id. With `side: 'head'` only Head rows are searched.
- After a concurrent rename, a selector can resolve through the Head id to another identity; `expected` (§9) detects
  it. Callers that apply what they reviewed pass `expected`.

### 4.3 Normalisation

| Selector targets | Result |
| --- | --- |
| A row or field of a created or removed table, or `tableData` of such a table | Requires the structure unit (`structureBoundData`). |
| A field of a created, deleted or replaced row | Requires the row's existence unit (`wholeRowUnit`). |
| A pointer to an object | Selects the field units inside it. |
| A pointer inside an array or file value | Requires the field unit of the whole value (`atomicValue`). |
| A pointer at, inside or above a changed field | Requires the structure unit (`structureBoundData`), and selects the unchanged field units under it. |
| A pointer to a computed leaf | Blocker `notSelectable`. |

### 4.4 Exclusions

`exclude` items resolve like included items. Excluded are the units they select and the units their normalisation
would require: an excluded pointer inside an array excludes the array's unit; an excluded field of a created row
excludes the creation. The closure never adds an excluded unit; if one is needed, the result has the blocker
`requiredExcluded`.

### 4.5 Unmatched selectors

A selector, included or excluded, that matches no unit is returned in `unmatched` (same shape as the items, with
`exclude` nested). If nothing matched at all the status is `empty`; if some selectors matched and others did not, the
status is `blocked` with `unmatchedSelector`.

## 5. Operations

Callers: the engine facade (`changes` namespace, §5.10), and through it the admin UI, public API, CLI and MCP
(REQ-001.BR-001). The engine features that plan and write, and their responsibilities, are defined in
[ADR-001, Modules and Interactions](../adr/ADR-001-partial-commit-and-revert.md#modules-and-interactions).

### 5.1 Common types

**Branch** `{ projectId: string; branchName: string }`, required in every operation; the operations act on its Head
and Draft.

**Unit** (public form):

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `kind` | `UnitKind` (§3.4) | yes | Unit kind. |
| `tableId` | string | yes | Draft table id, else Head table id; the shared schema id for `sharedSchema`. |
| `previousTableId` | string | no | Head id of a renamed table (`structure`). |
| `rowId` | string | for row units | Draft row id, else Head row id. |
| `previousRowId` | string | no | Head id of a renamed row (`rowRename`). |
| `path` | string | for `field` | JSON Pointer of the leaf. |
| `columns` | `('publishedAt' \| 'meta' \| 'schemaHash')[]` | for `rowColumns` | The differing columns the unit owns. |

**UnitRef** = Unit plus `side?: 'head'` and `selector: Selection`, with the same meaning as in ListedUnit (§5.2): a
selector that resolves to exactly this unit, so a caller can add it, or exclude it, by public ids alone (also a
Head-side unit whose id a rename took over).

**RequiredUnit** `{ unit: UnitRef; reason: Reason }`; **Reason** `{ code: RequiredReasonCode; tableId: string; rowId?:
string; path?: string; because: string }`. One reason per unit (the first found).

**Blocker** `{ code: BlockerCode; tableId?: string; rowId?: string; path?: string; message: string; unit?: UnitRef;
reason?: Reason }`, deduplicated by code, table, row and path. `unit` names the unit to remove or change when there is
one: the excluded required unit for `requiredExcluded` (with the `reason` that required it), the applied unit whose
target would dangle for `danglingInSource`, the unit of an invalid row for `invalidRow`.

**Deferred** `{ unit: UnitRef; paths: string[]; structure: UnitRef }`: a created or replaced row committed without its
table's structure; `paths` are the changed fields that get Head defaults; `structure` is the unit that would carry
their Draft values.

**Estimate** (§6.5; an upper bound: a merge that turns out content-equal to one side is still counted):

| Field | Type | Meaning |
| --- | --- | --- |
| `changedRows` | integer | Changed rows of the affected tables (§6.2). |
| `mergedRows` | integer | Merged or converted rows in mixed tables. |
| `perRowWorkRows` | integer | The part of `mergedRows` in tables whose target schema has formula or File fields. |
| `mixedTables` | `{ tableId: string; linksCopied: integer; linksAdded: integer }[]` | Per mixed table: row links copied into a new table version (0 for an in-place revert) and links added. |

**Counts** `{ selected: integer; required: integer; remaining: integer }`: selected units after exclusions; required
additions; units not applied among those the operation knows: every table-level unit (structure, views, shared
schema; their system rows are always read) and the row units of the tables it read. Row units of unread tables are
not counted; `unreadTables` gives the number of such tables. A full count is obtained by paging `listChanges`.

### 5.2 `listChanges`

Pages the selectable units with exact selectors. Read-only.

Input:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `branch` | Branch | yes | |
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

**ListedUnit** = UnitRef (§5.1) plus `structure`:

| Field | Type | Meaning |
| --- | --- | --- |
| `side` | `'head'`, optional | The selector needs `side: 'head'` (an id taken over by a rename). |
| `structure` | Unit, optional | The structure unit of the same table, for other units of a table that has one. |
| `selector` | Selection | Resolves to exactly this unit with no required units, blockers or unmatched items: `fields` for a field, `rows` for row lifecycle units, `renames` for a rename, `rowColumns` for row columns, `tables` for a structure, `views`, `sharedSchemas`. |

Order: `tableId`, `rowId` (table-level units first), `kind`, `path`, `previousTableId`, `previousRowId`, in code-point
order, and finally the internal unit key (carried in the cursor) so the order is total. The cursor carries the sort
key of the last returned unit and the table to resume from. The listing has no total: it would need every table read.

Reading is incremental:

- Each page reads the table pairs and the system tables (as §6.2 steps 1–3), then the changed rows of one table at a
  time, in listing order from the cursor's table (only `tableId` when given), and stops as soon as the page is full.
  Tables after the last one it needed are not read.
- **Keyset paging inside a table (required).** A page reads the changed rows of a table in keyset order of the unit
  row id, starting at the cursor's row, and stops when the page is full. Every changed row read yields at least one
  unit, so a page reads at most `pageSize` changed rows and needs no separate size guard. A row whose units do not
  fit continues on the next page from the cursor. (The PoC still read every changed row of each table it listed.)
- Refused tables (§6.10) are not read for units; every page returns them in `refusedTables`.
- A page can hold fewer than `pageSize` units, or none; only `nextCursor = null` ends the listing.
- Paging is snapshot-free: each page reads its own snapshot and returns its Head and Draft ids; under concurrent edits
  units can move between pages. What is applied is bound by `expected`, not by the listing.

### 5.3 `previewChanges`

Dry run of a commit or revert. Read-only.

Input:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `branch` | Branch | yes | |
| `operation` | `'commit' \| 'revert'` | yes | The operation to plan. |
| `selection` | Selection | yes | §4. |
| `includeRequired` | boolean | no, default `false` | Treat required additions as accepted (affects only `status`). |

Output:

| Field | Type | Meaning |
| --- | --- | --- |
| `status` | `'ready' \| 'required' \| 'blocked' \| 'empty'` | §5.6. |
| `headRevisionId` | string | Head the plan was made on. |
| `draftRevisionId` | string | Draft the plan was made on. |
| `fingerprint` | string | §9; `''` when a limit refused the plan (`tooLarge`). |
| `counts` | Counts | |
| `unreadTables` | integer | Unread tables (§1); their row units are not in `counts.remaining`. |
| `refusedTables` | `{ tableId: string; code: 'headSchemaInconsistent' \| 'unledgeredTable' }[]` | Every refused table of the branch (§6.10); empty for exactly `{ all: true }`. Their units are not computed or counted. |
| `required` | RequiredUnit[] | Every required addition with its reason. |
| `blockers` | Blocker[] | Every blocker, including `migrationInProgress`. |
| `deferred` | Deferred[] | Commit only. |
| `sample` | UnitRef[] | Up to 20 applied units in listing order (display only; `listChanges` is the complete list). |
| `unmatched` | Selection items | §4.5; empty object when all selectors matched. |
| `estimate` | Estimate | §5.1, §6.5; limits in §11. |

### 5.4 `commitChanges`

Input:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `branch` | Branch | yes | |
| `selection` | Selection | yes | §4. |
| `includeRequired` | boolean | no | Apply required additions; requires `expected`. |
| `expected` | string | engine: no; public API and MCP: yes unless the selection is exactly `{ all: true }` | Fingerprint of a commit preview of the same selection. |
| `comment` | string | no, default `''` | Stored on the new Head revision. |

Output by status:

| Status | Fields |
| --- | --- |
| `applied` | `previousHeadRevisionId`; `headRevisionId` (the former Draft revision, now Head); `draftRevisionId` (new Draft); `applied: { selected, required }`; `remaining: { units, unreadTables }` (as Counts and `unreadTables` of §5.3); `renumbered: { from: string; to: string }[]` (empty when nothing was renumbered). |
| `required` | `required`. |
| `blocked` | `blockers`, `required`, `unmatched` (when present). |
| `stale` | none. |
| `empty` | `headRevisionId`, `draftRevisionId` (current), `unmatched` (when present). |

### 5.5 `revertChanges`

Input: as `commitChanges` without `comment`; `expected` is the fingerprint of a revert preview.

Output: as `commitChanges`, except that `applied` returns `headRevisionId` (unchanged Head) and `draftRevisionId` (the
same Draft revision), with no `previousHeadRevisionId` and no `renumbered`.

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
| `stale` | The state changed since the preview. | nothing |
| `empty` | Nothing to apply (also a repeat of an applied commit). | nothing |
| `applied` | Commit or revert written. | §6.13, §6.14 |

### 5.7 Required reasons

| Code | Source | Meaning | Unit to add |
| --- | --- | --- | --- |
| `wholeRowUnit` | selection | A field of a created, deleted or replaced row was selected. | The row's existence unit. |
| `atomicValue` | selection | A pointer inside an array or file value. | The field unit of the whole value. |
| `structureBoundData` | selection, closure | A value of a new or changed field; a row of a created or removed table; a reference at a changed field that would dangle. | The table's structure unit. |
| `referencedRowMissing` | closure | A target row references a row that exists only on the other side; or an unchanged row references an id the target loses and another unit provides. | The unit that brings the row (creation, replace, rename). |
| `referrerStillReferences` | closure | A target row or schema still references a row or table the operation removes from the target. | The referrer's other-side value (field or row unit) or its structure unit. |
| `idOccupied` | closure | Two rows, or two tables, would hold one id in the target. | The unit that moves the occupant (rename, deletion, structure). |
| `referencedTableMissing` | closure | A target schema references a table that exists only on the other side. | That table's structure unit. |
| `viewsDoNotFitStructure` | closure | The target views document does not validate against the target structure. | The views or the structure unit, whichever is not applied. |

### 5.8 Blockers

| Code | Meaning | Caller action |
| --- | --- | --- |
| `requiredExcluded` | A required unit is excluded; `unit` and `reason` name it and why it is required. | Drop the exclusion or the unit that needs it. |
| `notSelectable` | A field selector addresses a computed value. | Select its inputs. |
| `danglingInSource` | No unit can restore consistency: the source is inconsistent (for example a native rename rewrote at most 100 referrers), a selected deletion is still referenced by an unchanged row, or a required unit is already applied and the problem remains. | Change the selection or repair the Draft natively. |
| `invalidRow` | An assembled row fails its target schema. | Change the selection. |
| `invalidViews` | The views document is invalid for its structure on the same side. | Fix the views natively. |
| `ledgerInconsistent` | A resulting ledger does not replay to its schemas (a mismatch the operation introduces); a published migration is missing or changed in the Draft ledger; a pending migration cannot be attributed to a table (§10.1); or a Draft schema history does not extend its Head history. | Change the selection, or repair the Draft natively. |
| `unrecordedStructureChange` | The Draft structure is not reproduced by its schema history and migrations (an async migration on a schema row the Draft already owned, until stage 0): its commit is refused, and Head rows cannot be migrated into it. Reverting it is allowed. | Commit other units; revert the structure. |
| `headSchemaInconsistent` | Head schema check (§6.10): a selector or a required addition involves a table whose Head schema does not match the schema replayed from the Head ledger (left by a completed native async migration, published or not). `tableId` is set. Raised by every partial operation on that table, with no exception (`all: true` with `exclude` names every table). Not raised for exactly `{ all: true }`. | Commit or revert natively or with exactly `{ all: true }`; to make the table eligible again, run the forward-only repair (§12) and publish it with a native or exactly `{ all: true }` commit. Units of other tables are unaffected. |
| `unledgeredTable` | A selector or a required addition involves an unledgered table (§6.10): present in the Head with no `init` migration in the Head ledger (including a revision without a migration table), or created in the Draft with no pending `init`. `tableId` is set. Not raised for exactly `{ all: true }`. | Commit or revert natively or with exactly `{ all: true }`; a ledger backfill is a stage-0 design item (§12). |
| `migrationInProgress` | Preview only: an async migration is active on the branch. | Wait for it. |
| `unmatchedSelector` | Some selectors match no unit. | Fix the selection. |
| `tooLarge` | A limit (§11) is exceeded; `tableId` is set for a per-table limit. | Select less. |

When unique constraints ([ADR-0029]) are implemented, a uniqueness blocker is
added (§6.9). Until delivery stage 3 (ADR-001), a commit that applies a structure unit returns `blocked` with the
temporary code `structureCommitUnavailable`.

### 5.9 Errors

| Condition | Result |
| --- | --- |
| `includeRequired: true` without `expected` | Validation error before any transaction. |
| A malformed selection: an unknown field, a wrong type, an empty id, a `path` that is not a JSON Pointer (RFC 6901, including invalid `~` escapes), `side` other than `'head'`, `all` or `exclude` inside `exclude` | Validation error before any transaction. (A well-formed selector that matches nothing is `unmatched`, §4.5.) |
| Invalid `pageSize` or `cursor`, or a `tableId` that names no Head or Draft table, in `listChanges` | Validation error. |
| Unknown project or branch | Not-found error (native). |
| Commit or revert while an async migration is active on the branch | `MigrationLocked` error (native lock). |
| Operation or statement timeout, attempts exhausted, any write failure | Error; the transaction is rolled back; nothing is persisted, including file references and ledger rows. A retry is safe (§9). |

### 5.10 Facade and transports

- The engine facade exposes the four operations in a `changes` namespace (as the archived v1 contract did), so the
  flat native `createRevision` and `revertChanges` keep their signatures (REQ-001.BR-005).
- Public API, CLI and MCP map the same fields one to one (REQ-001.BR-001). The public API and MCP reject a partial
  `commitChanges` or `revertChanges` without `expected`; only the exact selection `{ all: true }` may omit it. The
  engine operations keep `expected` optional for internal callers.
- Paths are JSON Pointers at every boundary; native dot paths stay internal to the patch APIs.

**Transport contract (delivery stage 4).** Names are proposals; they avoid the native `revertChanges`.

| Engine facade | GraphQL | MCP tool | Permission ([permission-system-v1]) | Audit action ([audit-logs-v1]) |
| --- | --- | --- | --- | --- |
| `changes.list` | query `draftChanges` | `list_draft_changes` | `read` on Revision (`canReadRevision`) | none |
| `changes.preview` | query `previewDraftChanges` | `preview_draft_changes` | same as `changes.list` | none |
| `changes.commit` | mutation `commitDraftChanges` | `commit_draft_changes` | `create-revision` (create, Revision) | `revision.commit_changes` (new) |
| `changes.revert` | mutation `revertDraftChanges` | `revert_draft_changes` | `revert-revision` (revert, Revision) | `revision.revert_changes` (new) |

- The engine has no permission or audit layer; the host application enforces the permissions and writes the audit
  records, as it does for native `createRevision` and `revertChanges`.
- REST exposes the same four operations under the branch's Draft (`…/draft/changes`, `…/draft/changes/preview`,
  `…/draft/changes/commit`, `…/draft/changes/revert`), following the existing REST prefix conventions.
- Audit records are written for `applied` results only, with the operation's outcome as metadata: `all: true` or
  partial, `includeRequired`, applied and remaining counts, `renumbered`, previous and new Head ids (commit) or the
  Draft id (revert). The selection itself is not stored, only its counts.
- Endpoint effects ([endpoint-v1]): endpoints are bound to a revision id and resolve `head` and
  `draft` by revision. Native `createRevision` notifies nothing, because no revision id changes content; native
  `revertChanges` notifies for the Draft after its transaction. A partial commit changes what revision X contains
  (from Draft content to the assembled Head) and creates a new Draft, so after the transaction it notifies for X and
  for the new Draft (§6.13); a partial revert notifies for the Draft after the transaction (§6.14). Both use the
  engine's `notifyEndpoints` hook, which is a no-op in the engine package and implemented by the host.

### 5.11 TypeScript types

```ts
type Branch = { projectId: string; branchName: string };
type Side = 'head';

type RowRef = { tableId: string; rowId: string; side?: Side };
type SelectionItems = {
  tables?: Array<string | { tableId: string; side?: Side }>; // structure units
  tableData?: string[];                                      // row and field units of a table
  views?: string[];
  sharedSchemas?: string[];
  rows?: RowRef[];                                           // every unit of a row
  renames?: RowRef[];                                        // the rowRename unit only
  rowColumns?: RowRef[];                                     // the rowColumns unit only
  fields?: Array<{ tableId: string; rowId: string; path: string }>; // JSON Pointer
};
type Selection = SelectionItems & { all?: boolean; exclude?: SelectionItems };

type UnitKind = 'field' | 'rowCreate' | 'rowDelete' | 'rowReplace' | 'rowRename' | 'rowColumns'
  | 'structure' | 'views' | 'sharedSchema';
type Unit = {
  kind: UnitKind; tableId: string; previousTableId?: string; rowId?: string; previousRowId?: string;
  path?: string; columns?: Array<'publishedAt' | 'meta' | 'schemaHash'>;
};
type UnitRef = Unit & { side?: Side; selector: Selection };   // selector resolves to exactly this unit
type ListedUnit = UnitRef & { structure?: Unit };

type Reason = { code: RequiredReasonCode; tableId: string; rowId?: string; path?: string; because: string };
type RequiredUnit = { unit: UnitRef; reason: Reason };
type Blocker = { code: BlockerCode; tableId?: string; rowId?: string; path?: string; message: string;
  unit?: UnitRef; reason?: Reason };
type Deferred = { unit: UnitRef; paths: string[]; structure: UnitRef };
type Estimate = { changedRows: number; mergedRows: number; perRowWorkRows: number;
  mixedTables: Array<{ tableId: string; linksCopied: number; linksAdded: number }> };
type Counts = { selected: number; required: number; remaining: number };

type ListChangesInput = { branch: Branch; tableId?: string; cursor?: string; pageSize?: number };
type RefusedTable = { tableId: string; code: 'headSchemaInconsistent' | 'unledgeredTable' };
type ListChangesResult = { headRevisionId: string; draftRevisionId: string; units: ListedUnit[];
  nextCursor: string | null; refusedTables: RefusedTable[] };

type PreviewChangesInput = { branch: Branch; operation: 'commit' | 'revert'; selection: Selection;
  includeRequired?: boolean };
type PreviewChangesResult = { status: 'ready' | 'required' | 'blocked' | 'empty';
  headRevisionId: string; draftRevisionId: string; fingerprint: string; counts: Counts; unreadTables: number;
  refusedTables: RefusedTable[];
  required: RequiredUnit[]; blockers: Blocker[]; deferred: Deferred[]; sample: UnitRef[];
  unmatched: SelectionItems & { exclude?: SelectionItems }; estimate: Estimate };

type CommitChangesInput = { branch: Branch; selection: Selection; includeRequired?: boolean; expected?: string;
  comment?: string };
type RevertChangesInput = Omit<CommitChangesInput, 'comment'>;
type ApplyChangesResult = { status: 'applied' | 'required' | 'blocked' | 'stale' | 'empty';
  previousHeadRevisionId?: string; headRevisionId?: string; draftRevisionId?: string;
  applied?: { selected: number; required: number }; remaining?: { units: number; unreadTables: number };
  renumbered?: Array<{ from: string; to: string }>; required?: RequiredUnit[]; blockers?: Blocker[];
  unmatched?: SelectionItems & { exclude?: SelectionItems } };
```

`RequiredReasonCode` and `BlockerCode` are the codes of §5.7 and §5.8, including the temporary
`structureCommitUnavailable` (until delivery stage 3).

### 5.12 Examples

**Preview `required`, then commit with the reviewed additions.** Row `p1` of `products` points to a category `c9`
created in the Draft.

```json
{ "branch": { "projectId": "proj-1", "branchName": "master" }, "operation": "commit",
  "selection": { "fields": [{ "tableId": "products", "rowId": "p1", "path": "/category" }] } }
```

```json
{ "status": "required", "headRevisionId": "rev-h1", "draftRevisionId": "rev-d1", "fingerprint": "fp-1",
  "counts": { "selected": 1, "required": 1, "remaining": 3 }, "unreadTables": 0,
  "required": [{
    "unit": { "kind": "rowCreate", "tableId": "categories", "rowId": "c9",
              "selector": { "rows": [{ "tableId": "categories", "rowId": "c9" }] } },
    "reason": { "code": "referencedRowMissing", "tableId": "products", "rowId": "p1", "path": "/category",
                "because": "products/p1/category references categories/c9, which exists only in the Draft" } }],
  "blockers": [], "deferred": [], "unmatched": {}, "refusedTables": [],
  "sample": [
    { "kind": "rowCreate", "tableId": "categories", "rowId": "c9",
      "selector": { "rows": [{ "tableId": "categories", "rowId": "c9" }] } },
    { "kind": "field", "tableId": "products", "rowId": "p1", "path": "/category",
      "selector": { "fields": [{ "tableId": "products", "rowId": "p1", "path": "/category" }] } }],
  "estimate": { "changedRows": 4, "mergedRows": 0, "perRowWorkRows": 0, "mixedTables": [] } }
```

The caller commits the same selection with `"includeRequired": true, "expected": "fp-1"`, or adds the listed
`selector` to its selection, and gets `"status": "applied"` with `"applied": { "selected": 1, "required": 1 }`.

**`blocked`: a required unit is excluded.**

```json
{ "status": "blocked",
  "blockers": [{ "code": "requiredExcluded", "tableId": "categories", "rowId": "c9",
    "message": "categories/c9 is required but excluded",
    "unit": { "kind": "rowCreate", "tableId": "categories", "rowId": "c9",
              "selector": { "rows": [{ "tableId": "categories", "rowId": "c9" }] } },
    "reason": { "code": "referencedRowMissing", "tableId": "products", "rowId": "p1", "path": "/category",
                "because": "products/p1/category references categories/c9, which exists only in the Draft" } }],
  "required": [] }
```

**Commit of a structure unit with renumbering.** The Draft holds migration `2026-10-20T10:00:00.000Z` for
`products` and a later one, `2026-10-21T09:00:00.000Z`, for `orders`; only `orders` is committed, at
`2026-10-22T14:03:12.418Z`. The remaining `products` migration gets a new id by the native rule (the latest of the
current time, the last published `publishedAt` + 1 ms and the last published id + 1 ms), here the commit time.

```json
{ "status": "applied", "previousHeadRevisionId": "rev-h1", "headRevisionId": "rev-d1",
  "draftRevisionId": "rev-d2", "applied": { "selected": 1, "required": 0 },
  "remaining": { "units": 1, "unreadTables": 0 },
  "renumbered": [{ "from": "2026-10-20T10:00:00.000Z", "to": "2026-10-22T14:03:12.418Z" }] }
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
   - otherwise start with the user tables named by any selector, included or excluded (`tables`, `tableData`,
     `views`, `rows`, `renames`, `rowColumns`, `fields`), matched by Head or Draft public id; then add, transitively,
     every user table that shares a public id (Head or Draft) with an affected table (renames, reused and taken-over
     ids) and every user table connected to an affected table by a foreign key in its Head or Draft schema, in either
     direction;
   - the system tables are always read whole (step 3); `sharedSchemas` selects system rows only.

   This is enough because every required addition comes from the table itself, a table sharing an id or a table
   connected by a foreign key: the plan equals the plan that reads every table (AS-74).
5. Count the changed rows of the affected tables in SQL with the change predicate (§3.1). Rows of created or removed
   tables are not counted (they are linked whole). An affected table counts in full, even for a one-row selection
   (an accepted v1 limit). Above `maxChangedRows` → refuse with `tooLarge` and stop.
6. Load the changed row pairs of the affected tables (all columns of both versions). Unread tables (§1) are not read:
   their row units are neither counted nor applied, and their links do not change.

### 6.3 BuildCatalogue

1. Split the migration ledger into published (Head) and pending (Draft rows that Head does not link) entries and
   attribute every pending entry to a table identity (§10.1).
2. Pair the schema and views rows of every table; migrate the Head views document through the pending history with
   the views owner.
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

The result is the `estimate` (§5.1), an upper bound. A refused plan has the fingerprint `''` and is `blocked`
before the `expected` comparison, never `stale` (§5.6). No limit is rechecked after the closure: the last estimate
covers the final applied set.

### 6.6 CloseDependencies

```text
applied := selected ∪ required-by-normalisation
repeat:
  EstimateAndGuard(applied); refused → stop with tooLarge (§6.5)
  target := AssembleTarget(applied)                     (§6.7)
  findings := StructureChecks(target) ∪ RowChecks(target)
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
- **Views against the target structure**, validated by the views owner → `viewsDoNotFitStructure`, or
  `invalidViews` when views and structure come from the same side.
- **Foreign-key values of rows brought in wholesale** (created and restored tables; tables whose foreign-key leaves
  changed and come from the other side), checked in SQL as distinct values → `referencedRowMissing`.

Row checks:

- **Row id collisions** in a target table → the rename or existence unit of the row that keeps its base id
  (`idOccupied`).
- **Foreign-key values of target rows** (loaded rows of tables with foreign keys) that resolve nowhere in the
  target → the unit that brings the referenced row (`referencedRowMissing`); the referrer's other-side value
  (`referrerStillReferences`); the structure when the reference sits in a changed field (`structureBoundData`); or
  `danglingInSource`.
- **Unchanged referrers of ids the target loses**, found in SQL over the referrer tables → the unit that provides a
  row with that id (`referencedRowMissing`) or `danglingInSource`.

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
  | `hash`, `schemaHash` | native rules: hash of the merged data; hash of the target schema |
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
  migration rows = the target ledger (§10.2); views rows from the views target (the Draft document if the views unit is
  taken from the Draft; otherwise the Head document migrated through the pending history when S is Draft; otherwise
  the Head document); shared schema rows from their units' sides.
- **Tables without remaining units (relink).** Only tables the operation read are considered: affected user tables and
  the system tables. Such a table whose units are all applied (for system tables: no unit of the owning kinds remains —
  schema ← structure; migrations ← structure; views ← structure and views; shared schemas ← shared schema) is a *relink
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
3. Replay in memory the ledger of every resulting role with the native rules (a foreign-key target must exist at
   each step; `remove` is refused while referenced; `rename` refuses a taken id and rewrites referrer schemas) and
   compare with the role's schemas: commit → new Head and remaining Draft (with renumbered ids); revert → reverted
   Draft. A mismatch or failure that the source role does not already have → `ledgerInconsistent`. Inconsistencies
   that exist natively are tolerated, except damaged Head tables (§6.10). Unledgered tables (§6.10) are left out of
   the comparison (only exactly `{ all: true }` can apply their units).
4. Validate every merged row against its target schema → `invalidRow`.
5. When unique constraints exist ([ADR-0029]): validate uniqueness over the whole target table, not only the written
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

- **(b) Ledger replay — the refusal predicate.** When that revision's ledger has an `init` migration for the table,
  replaying the ledger with the native rules gives a schema deep-equal (object key order ignored) to the schema row.
  A table fails it when the replayed schema differs, or when the ledger no longer replays at all.
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
- **Unledgered table:** a table present in the Head with no `init` migration in the Head ledger (including every
  table of a revision without a migration table: the host created the project without one, and native writers then
  skip the ledger silently), or a table created in the Draft with no pending `init` migration. Predicate (b) cannot
  be evaluated for it.

**Refused tables.** A *partial operation* is anything other than exactly `{ all: true }` without `exclude`.

1. An unledgered table is refused with the code `unledgeredTable`. A ledger backfill for such tables is a stage-0
   design item (§12).
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
   `ledgerInconsistent`, AS-48), but it does not police damage the Head already has.

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
  to `PARTIAL_CHANGES_MAX_ATTEMPTS` (default 3). A timeout (`P2028`, or the database cancelling at the deadline) is not
  retried.
- One operation timeout `PARTIAL_CHANGES_OPERATION_TIMEOUT_MS` per attempt (also for preview and listing, §8.2),
  enforced by the database at the deadline: with PostgreSQL `transaction_timeout` (PostgreSQL 17 and later; the engine's
  Docker and CI setup runs 17) set to the operation timeout; on servers without it, `SET LOCAL statement_timeout` to the
  remaining budget before each statement. Setting `statement_timeout` once to the whole timeout is not enough: a
  statement started late could run up to twice the bound.
- `transaction_timeout` terminates the session (`FATAL`, SQLSTATE `25P04`) instead of cancelling the transaction. The
  attempt loop treats that connection error as the operation timeout and does not retry it. The implementation
  verifies how the timer is armed for one transaction (`SET LOCAL` inside it, or set on the session before `BEGIN`);
  if it cannot be armed per transaction, it falls back to the per-statement budget.
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
- Native revert cancels branch migrations and notifies endpoints; partial revert refuses until stage 0 (§17, question
  2).
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

- native writers take the fence shared; native and partial commit and revert, the async-migration swap and
  `applyMigrations` take it exclusive;
- the exclusive fence is taken in a separate holder transaction before the Serializable snapshot, so in-flight writers
  drain first;
- an operation takes it only after serialization failures (escalation) and with a `lock_timeout`; parameters are set
  in stage 0 (§17, question 3);
- consequence for native writers: every native writer takes the shared fence, and while an operation holds it
  exclusively, writers wait up to that operation's timeout. The evidence for the fence is one benchmark prototype
  (PoC M3), not a tested implementation.

## 9. Freshness and idempotency

### 9.1 Fingerprint

SHA-256 (unsigned, opaque) over:

- the operation (`commit` or `revert`), the Head revision id and the Draft revision id;
- for every applied unit, in unit order:
  - row units: per covered row, the Head and Draft row versions as `versionId`, `updatedAt` and the compared columns
    (`id`, `hash`, `schemaHash`, `publishedAt`, `meta`);
  - table-level units (structure, views, shared schema): the Head and Draft table version ids and the owned system
    rows (schema, views, pending migration rows) as above;
  - structure units whose Draft table version is mutable: a digest over the row count and the `versionId` and compared
    columns of every row of that version.

`updatedAt` and the compared columns are needed because native writes update a mutable version in place. The structure
digest makes structure freshness table-wide: any edit of that table's Draft rows, including a `publishedAt` or `meta`
edit that leaves `hash` unchanged, makes a selected structure unit `stale`. Consequences: a structure commit of a table
that others keep editing keeps returning `stale` (S3, S4), and the digest costs one pass over every row of that
table version per plan, O(table rows); this cost was not measured and must be measured before release (§11). The
fingerprint covers applied units only, so it does not depend on which tables were read (AS-74).

### 9.2 Rules

- `expected` is optional in the engine and required at the public API and MCP for partial operations (§5.10).
- `includeRequired: true` requires `expected`: required additions are applied only as reviewed.
- A commit fingerprint never matches a revert, and the reverse.
- A repeat of an applied commit or revert resolves to no unit → `empty` with the current ids; if part of the
  selection still resolves, `expected` gives `stale` and a selection with some unmatched selectors is `blocked`.
  An operation is never applied twice.
- A plan refused by a limit returns `blocked` (`tooLarge`), never `stale`, also when the Draft grew past the limit
  after the preview.

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
  published id; the commit result lists every change in `renumbered`.
- A revert drops the pending migrations of reverted structure units from the Draft ledger.
- Every resulting ledger replays to its schemas (§6.9).
- A table rename rewrites referrer schemas natively without migration rows; the replayed `rename` rewrites them on a
  replica, so a rename and the referrers it rewrote are published together (`referrerStillReferences`).

### 10.3 Guarantees

| Consumer | Guarantee |
| --- | --- |
| Replica synced from Head exports (`getMigrations` of Head → `applyMigrations` into its Draft → commit) | Accepts every partial commit and every later commit; its replayed schemas equal the source Head schemas (REQ-001.BR-004). `applyMigrations` applies one migration per transaction, so the guarantee is incremental, not all-or-nothing: the replica's ledger is always a prefix of the source Head ledger, each migration applies atomically, and a resumed sync continues from the next id (with the stage-0 in-transaction id check). Depends on the stage-0 must items (§12), including the async-migration fix and copy-on-write by `INSERT … SELECT`. Not covered: an exactly `{ all: true }` commit of an unrepaired damaged table (§6.10) publishes a Head no replica can reproduce, exactly as native commit does; unledgered tables (§6.10) were never received by a replica through migrations, and partial operations refuse them. |
| Replica synced from Draft exports | Unsupported: a renumbered migration is offered again under a new id and fails (for example "field already exists"). `renumbered` lets such a consumer detect it. |
| Replicas of large tables | Native limits apply independently of partial commits: memory of synchronous table updates (backlog, §12). |

## 11. Limits and configuration

All defaults are **provisional**. Re-measuring them (at least 3 runs per cell on production-like hardware) is part
of the release gate (§12); they are re-measured again after each stage-0 "should" item lands. The PoC sandbox
(2 CPU, 4 GB) measured at 100k changed rows (cases as named in the
[research summary](../research/partial-changes-poc-v2.md)):

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
structure-digest cost (§9.1) was not measured and is measured before release.

| Setting | Default | Counts | Effect |
| --- | --- | --- | --- |
| `PARTIAL_CHANGES_MAX_CHANGED_ROWS` | 100,000 | Changed rows of the affected tables (§6.2); an affected table counts in full | Above → `tooLarge` before the catalogue. |
| `PARTIAL_CHANGES_MAX_PER_ROW_WORK` | 10,000 | Merged or converted rows in mixed tables whose target schema has formula or File fields | Above → `tooLarge` before the closure assembly that would exceed it (§6.5). |
| `PARTIAL_CHANGES_MAX_MIXED_TABLE_LINKS` | 250,000 | Links copied into one new table version (an in-place revert copies none) | Above for any table → `tooLarge` with `tableId`, before that assembly (§6.5). |
| `PARTIAL_CHANGES_OPERATION_TIMEOUT_MS` | 180,000 | Lifetime of one preview, one listing page, or one commit or revert attempt | Expired → error, rollback; enforced by `transaction_timeout` or per-statement budgets (§8.1). |
| `PARTIAL_CHANGES_MAX_ATTEMPTS` | 3 | Serializable attempts of the operation's own loop (§8.1) | Exhausted → error. |
| `listChanges` `pageSize` | 500 (max 5,000) | Units per page, and so changed rows read per page (§5.2) | — |

`all: true` reads every table, so a Draft above `maxChangedRows` can be committed whole only natively. When stage 0
brings compiled formulas and set-based file registration, the per-row-work limit is re-measured.

## 12. Native prerequisites (stage 0)

**One release gate.** No partial operation is released before every "must" item below and the release gate are done.
Delivery stages 1–3 (ADR-001) may be developed in parallel with stage 0. Paths are under `src/features/` at master
`139eb7b` unless they start with `src/` or `prisma/`.

**Async migration fix, detection and repair** (its own stage-0 design: a new version of
[async-row-migration-v1]). This SPEC depends on these results:

| Requirement | Today (139eb7b) | Where |
| --- | --- | --- |
| Copy-on-write of the schema and views rows before the swap; the swap writes the `update` migration row and the schema history with the migration's original patches. | The swap updates both rows in place by `versionId` and records nothing, so every revision linking those row versions changes (§8.3). | `migration/services/migration.service.ts:450-457` (schema row), `:500-508` (views row) |
| The swap re-checks that the revision is still the Draft and the source table is still linked. | No re-check. | `migration.service.ts:390-418` |
| One async migration per revision at a time, checked inside the transaction. | A unique key blocks a second one on the same table only; other tables are guarded by a check outside the transaction. | `migration/commands/handlers/start-async-migration.handler.ts:33-99`; `draft/commands/handlers/api-update-table.handler.ts:35` |
| Validation equal to the synchronous path (foreign-key targets, formulas, data). | Meta-schema only. | `start-async-migration.handler.ts:69-77` vs `draft/commands/handlers/transactional/validate-schema.handler.ts:23-48` |
| File references for migrated rows. | Migrated rows get no blob links. | `migration/services/migration-batch.service.ts:84-112` |
| Orphan cleanup spares in-flight shadow tables. | It deletes every table no revision links, including shadow tables before their swap. | `src/infrastructure/database/cleanup.service.ts:41-51`; `migration.service.ts:240-250` |

- **Detection (scan).** The scan covers every revision of every branch (Head, Draft and earlier revisions), but
  evaluates predicate (b) once per distinct pair of ledger version and schema-row version, and predicate (a) once per
  distinct table version, because versions are shared across revisions. It reports: damaged tables (predicate (b)
  failures, §6.10), with damaged earlier revisions reported as damaged history; ledgers that no longer replay at all,
  because a later published migration builds on the unrecorded change (for example a rename of the field the async
  migration added); unledgered tables; and predicate (a) failures as a diagnostic only, each marked with its known
  false-positive sources (a table that references a renamed table; rows written through the low-level row API).
  Predicate (a) refuses nothing. Views are covered as §6.10 describes.
- **Repair (forward-only): the recorded native write, replayed.** Nothing committed is rewritten again. In the
  Draft, the repair writes what a recorded native synchronous `updateTable` would have written:
  - **Patch:** the diff from the schema replayed from the Head ledger to the Head schema row, so it covers only the
    change the Head shows and the ledger does not record (not the Draft's own pending changes). The async migration
    record is deleted when the migration completes (`migration/services/migration.service.ts:511-520`), so the patch
    can only come from this diff. A diff turns a field rename into remove and add: on replicas that apply the repair
    migration, that field's values are lost. The stage-0 fix records future async migrations with their original
    patches, so no new damage needs a diff.
  - **Position:** a migration row whose id `nextNativeMigrationId` computes from the last published migration (so
    Head-synced replicas accept it), placed before the table's pending migrations. The Draft's pending migrations
    that it would follow are renumbered after it in their original order by the native rule, as in §6.8; they are
    unpublished, so this is allowed. The renumbering is reported as for a commit.
  - **History and rows:** the patch is inserted into the Draft schema row's history at the same position (after the
    Head's history prefix, before the pending patches), and the Draft gets its own schema and views row versions where
    it still shares the damaged ones.
  - **Verification and rollback:** after writing, the repair checks that replaying the Head ledger followed by the
    pending migrations gives the Draft schema. If it does not, the repair of that table is rolled back, and the scan
    reports the table as needing its Draft structure reverted first (natively or with a whole-Draft revert, since
    partial operations refuse the table).

  The table becomes eligible for partial operations again only after a native or exactly `{ all: true }` commit
  publishes the repair (§6.10); earlier revisions stay as they are, and rewriting history would need its own ADR and
  is not planned. The repair is not a gate for partial operations: the refusal of §6.10 protects damaged tables, and
  native or `{ all: true }` commits still work. Draft-only damage (§6.10) needs no repair: reverting the table's
  structure unit removes it.
- **Ledgers that no longer replay** cannot be repaired forward: such tables stay refused, and their Head-synced
  replicas need a re-sync.
- **Ledger backfill for unledgered tables** (stage-0 design item decided with the scan results, not a release gate):
  forward-only like the repair, it would add an `init` migration for such a table to the Draft so that a later commit
  gives it ledger history. Until then partial operations refuse those tables (`unledgeredTable`).
- **No change to table rename** in stage 0: re-hashing the referencing rows would copy every row of every
  referencing table; predicate (a) reports such tables as known false positives instead.
- **Release gate:** the async migration fix shipped; the forward-only repair tool; the scan run on existing
  deployments with its results reviewed (damaged tables and history, ledgers that no longer replay, unledgered tables,
  and the predicate (a) diagnostics with their known false positives); the Head schema check
  (`headSchemaInconsistent`, `unledgeredTable`) in partial operations; limits re-measured on production-like hardware
  (§11), including the row-digest cost (§9.1).

**Other items.**

| Priority | Item | Why | Where |
| --- | --- | --- | --- |
| Must | `applyMigrations` applies an `update` synchronously or waits for the async migration before reporting `applied`. | Above the threshold the update goes async, is reported `applied`, writes no ledger row, and later migrations of the batch hit the lock. | `draft/commands/handlers/migration/apply-migrations.handler.ts:107-112, 126-129`; `draft/commands/handlers/api-update-table.handler.ts:37-38` |
| Must | `applyMigrations` checks the migration id inside the migration's transaction. | The existence and id checks run outside any transaction (race). | `apply-migrations.handler.ts:141-162, 164-188` |
| Must | Migration lock checked inside the writer's transaction, in every API writer; views writes check it at all. | Every API writer checks before its transaction starts; views writes do not check. | `draft/commands/handlers/api-create-revision.handler.ts:25-28` vs `:33`; `api-create-row.handler.ts:35` vs `:37`; `api-update-table.handler.ts:35` vs `:61`; `views/views-api.service.ts:31-37` |
| Must | Referrer rewrites and the row-removal guard without the 100 limits. | A row rename rewrites at most 100 rows per referrer table and searches at most 100 referrer tables; a table rename rewrites at most 100 referrer schemas; the row-removal guard checks at most 100 referrer tables and fails above 1,000 paths × row ids. Native commit publishes the dangling rest. | `share/foreign-keys.service.ts:8, 89, 157, 212-217`; `draft/commands/handlers/transactional/internal-rename-row.handler.ts:108-118, 167-183`; `transactional/rename-schema.handler.ts:55-59`; `draft/commands/handlers/remove-rows.handler.ts:74-80` |
| Must | Serializable views writes. | Views writes run with default isolation, so a concurrent update can change a views row that a commit has just published. | `views/views-api.service.ts:31-37`; `views/commands/handlers/update-table-views.handler.ts:55-88` |
| Must | Branch write fence (§8.4). | Long Serializable commits (native and partial) starve under continuous writers. Evidence: one benchmark prototype. | `src/infrastructure/database` and native writers |
| Must | Table copy-on-write by `INSERT … SELECT`. | The first native edit of a table loads every row version id and connects them in one write; the PoC hit `P2029` above 32,767 rows (32,800 in M5, the replica sync in M3). Large tables and the replica guarantee depend on it. | `draft-revision/commands/handlers/draft-revision-get-or-create-draft-table.handler.ts:103-115, 117-145` |
| Should | `createRevision` finds the rows to lock without scanning shared readonly rows. | Its lock is one `updateMany` that updates only mutable rows, but its filter joins every row of every table version of the revision, shared readonly ones included (7.8 s for 1k changes in a 1M-row table). | `draft-revision/commands/handlers/draft-revision-commit.handler.ts:97-105` |
| Should | Formulas compiled once per schema. | Formulas are parsed per formula per row; dominates merges. | `plugin/formula/formula.plugin.ts:49-79` → `plugin/formula/formula-calculation.ts:13-15` |
| Should | Set-based file registration for row versions. | Several queries per row. | `file-usage/commands/handlers/register-file-references-for-rows.handler.ts:52-54, 93-137` (called by `register-file-references-for-row-versions.handler.ts`) |
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

- AS-10 `products` gets field `color` while prices change → prices commit alone; later `tables: ['products']`
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
- AS-17 Rename: rename alone (`renames`), field edit alone under the Head id, whole renamed row links the Draft
  version; a listed `renames` selector does not take a field edit made after the listing.
- AS-18 Selectors: pointer inside an array → `atomicValue`; field of a created row → `wholeRowUnit`; formula output →
  `notSelectable`; nested pointer and object pointer; excluded pointer inside an array excludes the array.
- AS-19 Independent views edit commits and reverts alone; the automatic views migration belongs to the structure.
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
  migration 1 is renumbered after it and reported in `renumbered`; a Head-synced replica accepts this commit and the
  later one; replayed schemas equal the source; no renumbering when not needed.
- AS-41 Property sequences (fixed seeds, 20 steps: native edits, native and partial commits and reverts) start with a
  partial commit that renumbers; every step's status is asserted; after every step every pending Draft migration id
  is greater than the last published id; a final `all: true` leaves nothing and the replica equals the source.
- AS-42 A replica synced from Draft exports fails on a renumbered migration (recorded, unsupported).
- AS-43 A renamed table referenced by another table requires the referrer's structure and the reverse; together they
  keep a replica in sync. A schema foreign key to a created table requires that table.
- AS-44 Structure revert of one of two tables → remaining Draft rows mapped back (Head values for changed fields of
  existing rows, Head defaults for created rows), the other table untouched, its migrations dropped, the remaining
  ledger replays; created table reverted with its rows; removed table restored.
- AS-45 Views on a new field: committing the views requires the structure; reverting the structure requires the
  views; Head views migrate with a committed structure while a views edit stays in the Draft.
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
  - AS-47c After the forward-only repair (§12) but before it is published, every partial operation on the table is
    still `blocked`. After a native commit publishes the repair, the table's Head ledger replays to its Head schema,
    a partial commit of its units applies, and a Head-synced replica applies the repair migration.
  - AS-47d `listChanges` lists no units of the damaged table and returns it in `refusedTables`; a preview that selects
    it returns `blocked` (`headSchemaInconsistent`), not `unmatched`.
  - AS-47e Head-schema-row baseline (unrepaired Draft): exactly `{ all: true }` commit and revert produce the same
    Head, Draft and ledger as native `createRevision` and `revertChanges`, with no `unrecordedStructureChange`;
    native commit stays available; `{ all: true, exclude }` → `blocked`.
  - AS-47f A table that fails only predicate (a) (rows of a table that references a renamed table) → partial
    operations apply normally; the scan reports it as a diagnostic with its known false-positive source.
  - AS-47g Replayed-ledger baseline (repaired Draft): an exactly `{ all: true }` commit is `applied` with no
    `unrecordedStructureChange`; it publishes the repair migration, the new Head passes predicate (b), and a
    Head-synced replica applies the repair migration.
  - AS-47h Neither baseline (SQL fixture: the Draft schema matches neither the Head schema row nor the replayed
    schema after the pending migrations) → an exactly `{ all: true }` commit is `blocked`
    (`unrecordedStructureChange`).
  - AS-47i Repair with pending migrations for the table (after the stage-0 fix, the Draft holds a recorded pending
    migration of the damaged table that builds on the unrecorded change, for example a rename of the field the async
    migration added): the repair writes the repair migration with the diff from the replayed schema to the Head
    schema row, places it before that pending migration and renumbers the pending migrations after it; the
    verification passes; an exactly `{ all: true }` commit is `applied`, the new Head passes predicate (b), and a
    Head-synced replica applies the repair migration and then the renumbered one. When the verification fails (SQL
    fixture of a pending migration the repair cannot precede), the repair of that table is rolled back, the Draft is
    unchanged, and the scan reports the table as needing its Draft structure reverted first.
- AS-48 Ledger attribution: a pending migration that cannot be attributed (SQL fixture), or a Draft schema history
  that does not extend the Head history → every preview, commit and revert is `blocked` (`ledgerInconsistent`).
- AS-49 Unledgered table (§6.10): a Head table with no `init` migration in the Head ledger (SQL fixture; and a
  project whose revisions have no migration table), and a table created in the Draft with no pending `init` (SQL
  fixture) → every partial operation on it is `blocked` (`unledgeredTable`) and listing returns it in
  `refusedTables`; units of other tables apply; exactly `{ all: true }` and native commit and revert it as before. A
  table created in the Draft with its pending `init` is not affected (AS-14).

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

- AS-60 `listChanges` lists every unit kind with public ids, `side: 'head'` where needed, the structure link, and a
  selector that previews exactly that unit; paging with the cursor; read-only.
- AS-61 Property over random Drafts: each listed selector alone previews one unit with no `unmatched` or
  `notSelectable`; the union of the listed selectors previews with the same status, counts and fingerprint as
  `all: true`, for commit and revert.
- AS-62 Preview and listing run in a `READ ONLY` transaction and change nothing in the database.
- AS-63 A selected row changed after preview → `stale`, nothing written; an unrelated row changed → applied; a value
  of a structure-bound field, a table rename or a views edit after preview → `stale`; another table changed → applied.
- AS-64 `includeRequired` without `expected` → validation error; a commit fingerprint does not pass a revert; one
  unmatched selector (included or excluded) → `blocked`; nothing matched → `empty` with current ids; a repeated
  commit → `empty`, no revision; a malformed pointer or selector → validation error (§5.9).
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
  the limit read only the affected table and apply; changed rows of tables connected by a foreign key count;
  `all: true` reads every table; an unread table with only content-equal versions keeps its Draft version. Property over
  random Drafts and selections (including `exclude`, commit and revert): the scoped plan equals the plan that reads
  every table (status, fingerprint, selected, applied, required, blockers, unmatched, deferred, estimate except
  `changedRows`, ledger, per-table outcomes, written rows and views). Benchmark: a one-field commit and revert next
  to a changed unrelated table of 200,000 rows are not refused and their time does not depend on that table.
- AS-75 Guard before work: the estimate runs before every closure assembly, and a refused plan assembles nothing;
  preview, listing, commit and revert run under the operation timeout, so a preview whose planning outlasts the
  default transaction timeout still returns; a Draft that grows past a limit after preview → `blocked` (`tooLarge`),
  not `stale`.

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
  unledgered tables not refused (AS-49 applies); listing without keyset paging (a page reads a whole table); no deadline
  enforcement (`transaction_timeout` or per-statement budget); the engine-wide retry loop instead of the operation's
  attempt cap; no write fence; required, deferred and blocking units without exact selectors; endpoint notification
  inside the transaction or missing; unattributable migrations ignored (AS-48); published-at ownership by the first of
  several leaves; an unclassified model column; a writer that locks by scanning the table (a cost assertion on locked
  rows).
- **Benchmarks** fail the run on any check and verify every Head and Draft row in SQL: data, `hash`, `schemaHash`,
  formula consistency, `readonly` of rows and tables, no dangling foreign keys, file links and project bytes; at least
  3 runs per cell on production-like hardware; the estimate is compared with the links and rows written. A scoped
  benchmark adds a changed unrelated table and checks that its versions stay untouched.
- **Gaps to close in implementation:** JSON Pointer escapes (`~0`, `~1`); applied reverts of swaps and reused ids;
  Head-id fallback after a concurrent rename; views that do not fit after migration (the fallback branch); races with
  files; closures through several referrer tables; AS-31's "referenced by an unchanged row → `danglingInSource`";
  a `RowPublishedAt` inside an array and several `RowPublishedAt` fields in one schema (§3.1); scoped reading with
  large foreign-key-connected tables; keyset paging inside a table (§5.2); the Head schema check and repair (§6.10,
  AS-47); exact selectors on required and blocking units (§5.1); post-commit notification (§6.13); the deadline and
  attempt loop (§8.1); the row-digest cost (§9.1). The PoC tested none of these; it did not build keyset paging,
  the Head schema check, exact selectors on required and blocking units, post-commit notification, the deadline or
  the attempt loop, and it did not measure the row-digest cost.

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
| Browse summary, changed tables, rows, details, pagination | Replaced | `listChanges` (paged units with exact selectors, read table by table, `tableId` filter, no total); native `revisionChanges`, `tableChanges`, `rowChanges` stay for display. |
| `planDraftChanges` (commit, discard) | Replaced | `previewChanges` (commit, revert), read-only. |
| `draftChangesPlanDetails` (paged effect groups) | Dropped | Required units with reasons, `deferred`, `renumbered`, `estimate`, `sample`. |
| `executeDraftChanges(planToken, requestId, requiredAcknowledgmentToken, message)` | Replaced | `commitChanges` / `revertChanges` with the selection, `includeRequired` + `expected`, `comment`. |
| Selectors `all`, `rows` | Covered | `all`, `rows` (+ `side`). |
| Selector `table` (rows all or none) | Replaced | `tables` (structure), `tableData`, `views`. |
| Selector `rowFields` (JSON Pointer) | Covered | `fields`. |
| Selector `schemaFields` | Replaced, coarser (required by REQ-001.BR-007) | `tables`: one structure unit per table. |
| Selector `change(ref)`, exact refs | Replaced | Public ids, `side: 'head'`, `renames`, `rowColumns`; transient incarnations grouped. |
| `exclude` | Covered | Widens to the containing atomic or whole-row unit; a needed excluded unit blocks. |
| Views per component | Replaced, coarser | Whole views document. |
| Shared schema facet | Covered for independent changes | `sharedSchemas`. |
| Plan statuses ready / confirmationRequired / blocked / empty | Replaced | ready / required / blocked / empty. |
| Execution statuses applied / replayed / stalePlan / blocked | Replaced | applied / required / blocked / stale / empty; a replay is `empty` with the ids. |
| Counts selected / automatic / required / remaining | Replaced | selected / required / remaining (over the tables read) and `unreadTables`; formula values and file links are not units. |
| Structured blockers | Covered | Richer codes (§5.8). |
| Result ids and counts | Covered | Previous Head (commit), Head, Draft, applied, remaining. |
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
- A complete `remaining` count in operation results (paging `listChanges` gives it) and a content-equality pass over
  unread tables (only `all: true` normalises them).
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
3. **Write fence parameters** (stage 0): escalation threshold, `lock_timeout`, and whether native `createRevision`
   shares `PARTIAL_CHANGES_OPERATION_TIMEOUT_MS`.
4. **False positives of predicate (a)** — closed: the refusal uses predicate (b) only; predicate (a) is a scan
   diagnostic with its known false-positive sources; table rename is not changed; unledgered tables are refused with
   `unledgeredTable`, and their ledger backfill is a stage-0 design item (§6.10, §12).

## Changelog

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
[audit-logs-v1]: https://github.com/revisium/architecture/blob/master/specs/audit-logs-v1.spec.md
[endpoint-v1]: https://github.com/revisium/architecture/blob/master/specs/endpoint-v1.spec.md
[permission-system-v1]: https://github.com/revisium/architecture/blob/master/specs/permission-system-v1.spec.md
