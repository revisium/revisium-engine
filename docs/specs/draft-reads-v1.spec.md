# Draft Reads Specification v1

## Overview

| Property | Value |
| --- | --- |
| Version | 1.5 |
| Status | Accepted; implemented ([ADR-002] delivery, PRs 8–11): PR 8, `changes.tableChanges` and `changes.summary` with their paging and filters; PR 9, `changes.rowChanges` with row items, fields, columns and keyset pages; PR 10, `idTakeover`, `idExchange` and `follows` (§5.3–§5.5); PR 11, the row `filters` of §1 and §7. ADR-002 PR 2 (views follow the structure, #178) has landed, so the §4 rules that name `views` or `structureChange.views`, and DR-10, hold. The reads are on the facade since ADR-002 PR 12 (#145) |
| Date | 2026-11-10 |
| Parent ADR | [ADR-002](../adr/ADR-002-draft-reads-and-public-changes-api.md) |
| Requirements | [REQ-001](../requirements/REQ-001-partial-commit-and-revert.md): REQ-001.BR-001, REQ-001.BR-003, REQ-001.BR-009 |
| Builds on | [partial-changes-v1](partial-changes-v1.spec.md) §3 (units), §4 (selection), §5.1–§5.2 (unit refs, listing), §6.2–§6.3 (snapshot, catalogue), §6.10 (refused tables) |
| Evidence | Engine branch `poc/draft-diff` (`ddb22c6`), document `docs/specs/draft-diff.poc.md` there; core and admin `poc/partial-changes` |

This specification defines the three reads that show a branch's Draft against its Head together with how each change
is selected: `changes.tableChanges`, `changes.rowChanges` and `changes.summary`. A client shows the Draft in lists of
tables and rows, lets the user select changes, and passes the selectors it got to `changes.preview`,
`changes.commit` and `changes.revert` unchanged. The engine derives every annotation from the change catalogue of
partial-changes-v1, so no client re-implements unit ownership.

The reads never run the native diff queries (`revisionChanges`, `tableChanges`, `rowChanges` of the
`revision-changes` feature), which join every row of both revisions; those stay for history and compare and do not
change. The reads reuse the native building blocks: the field diff of two row versions (after the formula values of
the page's rows are computed), and the mappers of schema migrations and views changes.

## 1. Operations

Every operation takes `branch: { projectId: string; branchName: string }` and is read-only.

| Operation | Input | Output |
| --- | --- | --- |
| `changes.tableChanges` | `branch`; `first` (integer 1–5,000); `after` (cursor, optional); `filters: { changeTypes?, search? }` (optional) | `DraftTablePage` (§9): table items, `pageInfo`, `totalCount`, ids, `refusedTables` |
| `changes.rowChanges` | `branch`; `first` (integer 1–5,000); `after` (optional); `filters: { tableId?, changeTypes?, search? }` (optional) | `DraftRowPage` (§9): row items, `pageInfo`, ids, `refusedTables`; no `totalCount` |
| `changes.summary` | `branch`; `filters: { changeTypes?, search? }` (optional, those of `tableChanges`) | `DraftChangesSummary` (§9) |

- An optional input given as `null` is treated as absent, at any depth, as in partial-changes-v1 §5.
- `first` outside 1–5,000 or not an integer, a malformed `after`, a cursor of the other read (a table cursor passed
  to `rowChanges` or the reverse), a filter of a wrong type, or a `search` holding the NUL character (no id holds it)
  → validation error before the snapshot.
- An unknown project or branch → the native not-found error.
- `changeTypes` takes the native `ChangeType` values (`ADDED`, `REMOVED`, `MODIFIED`, `RENAMED`,
  `RENAMED_AND_MODIFIED`).

## 2. Snapshot

Each call runs in one read-only Repeatable Read transaction under `PARTIAL_CHANGES_OPERATION_TIMEOUT_MS`
(partial-changes-v1 §8.2, §11), and every phase of the call reads that one snapshot:

1. the compared snapshot that every listing page reads (partial-changes-v1 §5.2, §6.2 steps 1–3): table pairs,
   system tables, structure analysis, the Head schema check;
2. the reported row pairs of the tables the call needs (§3);
3. the row versions of the page, their formula values and field diffs, the rows looked up for id exchanges and
   followed renames (§5).

A Draft edit that commits while a call runs changes nothing it returns. Every result returns the `headRevisionId` and
`draftRevisionId` it read and every refused table (`refusedTables`, partial-changes-v1 §6.10). Pages are not one
snapshot: each page reads its own, so concurrent edits can move items between pages. What a commit or revert
applies is bound by `expected` (partial-changes-v1 §9), not by the reads.

## 3. Reported tables and rows

A **table** is listed when it is on one side only, or on both sides with a different public id or a different table
version. System tables are not listed. Tables are paired by identity (`createdId`), so a table removed and created
again at one id (a replaced id) gives two items.

The **row pairs** of a listed table come from one query per table and call:

- a table on both sides with different versions: the anti-join of the two versions' row links (the row versions
  linked to one version and not to the other, as the listing reads them), paired by row identity; each of those row
  versions is read once, and the pair is compared where it is formed;
- a table on one side only: the rows of its version, all `ADDED` or all `REMOVED`.

A **row** is reported when it exists on one side only, or its `id`, data (`hash`), `publishedAt`, `meta` or
`schemaHash` differs, except: a row that differs only in `schemaHash` is reported only in a table whose structure is
unchanged (in a table whose structure differs, native writers rewrite every row with the new schema hash, and the
table item already shows the structure). A row that differs only in structure-bound data is reported and goes with
the structure (§5.1). The row's change type follows the native rule over these columns: `ADDED`, `REMOVED`,
`MODIFIED`, `RENAMED` (the id alone differs) or `RENAMED_AND_MODIFIED`. The native diff compares `id` and data only,
so the row columns are where the two depart: a row that differs only in `publishedAt`, `meta` or `schemaHash` is
`MODIFIED` here and absent there, and a renamed row that also differs in one of them is `RENAMED_AND_MODIFIED` here
and `RENAMED` there. `schemaHash` takes part in both rules only in a table whose structure is unchanged, so a renamed
row of a table whose structure differs is `RENAMED` when its data, `publishedAt` and `meta` are equal. Every count of
this specification counts reported rows only.

## 4. Table items

A table item (`DraftTableItem`, §9):

| Field | Meaning |
| --- | --- |
| `tableId` | Draft id, else the Head id of a removed table. |
| `previousTableId` | Head id of a renamed table. |
| `changeType` | `ADDED`, `REMOVED`, `MODIFIED`, `RENAMED` or `RENAMED_AND_MODIFIED`, by the rule below. |
| `replaced` | The item is one of the two items of a table id that the Draft removed and created again (partial-changes-v1 §3.7); the removed table is `REMOVED`, the created one `ADDED`. Set whether or not the table is refused. |
| `rowsSummary` | The table's reported rows (§3) by change type: `total`, `added`, `modified`, `removed`, `renamed`; a `RENAMED_AND_MODIFIED` row counts in `renamed` and in `modified`. |
| `schemaMigrations` | The pending migrations that the ledger attribution gives the table's identity (partial-changes-v1 §10.1), in ledger order, in the native migration detail shape. A renamed table lists its rename and every migration before and after it, under either id; of a replaced id, the removed table lists its removal and the created table its creation; a table created at the id of a transient table lists only its own. Each migration keeps its own `oldTableId` / `newTableId`: they name the step, not the item. |
| `viewsChanges` | The views stored under the table's Head id in Head compared with those under its Draft id in Draft, a side without the table or without a views row counting as no views, in the native views change shape. A renamed table whose views did not change has none; of a replaced id, the removed table removes its views and the created one adds its own. |
| `selection` | How the table's changes are selected (below). |

Migrations and views come from the compared snapshot, by the table's identity, without further reads. The native
history and compare reads look both up by table id and keep doing so. Units compare whole views documents
(`structureChange.views` and the views unit, partial-changes-v1 §3.6, §5.2), while `viewsChanges` lists the
differences of the views and of the default view, as the native mapper does; so a document that differs only
elsewhere (for example its `version`, the order of its views, or an empty document against none) has a unit or `structureChange.views: true` with
`viewsChanges.hasChanges: false`, and for a table that is not refused `viewsChanges.hasChanges: true` always comes with
one of them, except for the two items of a replaced id whose removed and created tables hold equal views documents:
`viewsChanges` compares each table's own sides, so both report a change, while their one structure unit carries none
(`structureChange.views: false`).

**Change type of a renamed table.** A native rename writes a new table version, so the native diff reports every
renamed table as `RENAMED_AND_MODIFIED`. The Draft reads report `RENAMED` when nothing but the table id differs and
`RENAMED_AND_MODIFIED` when also: the structure differs beyond the id (a pending migration other than the rename, a
different schema or schema history, or a changed field, partial-changes-v1 §3.3); the views document differs
(`structureChange.views`, below); the table has a reported row; or the table is refused, so the reads do not analyse
it. The row counts
decide only for a renamed table whose structure and views are unchanged: they are read once per call and shared with
its item.

**Table selection** (`TableSelection`):

| `state` | When | Content |
| --- | --- | --- |
| `refused` | The table, or a table removed or created at its id, is refused (partial-changes-v1 §6.10). | `code` |
| `selectable` | The table has a structure unit, a views unit or row units. | `structure` (with `structureChange`), `views`, `tableData` |
| `contentEqual` | The table versions differ but no compared column of any row does (partial-changes-v1 §3.8). | — |

- `structure` is the structure unit that holds the table identity, a `DescribedUnitRef`. Both items of a replaced id
  carry the same `replaced` structure unit.
- `views` is the table's views unit; it exists only when the table has no structure unit (partial-changes-v1 §3.6).
- `tableData` is `{ selector: { tableData: [Draft id] }, rows }`, present when the table is on both sides and its
  row counts find a pair that the listing's row change predicate selects. `rows` is the number of rows whose units
  the selector selects, each row counted by its row selector (the `row` of its `selectable` row item, §5.1):
  - a row on both sides counts once, whatever its units (a rename with its edits is one row);
  - the deleted and the created row of a replaced row share one `rowReplace` unit and one selector, so they count
    once;
  - a deleted row and the rename that took over its id are two rows (the deleted row's selector carries
    `side: 'head'`);
  - a row that only goes with the structure does not count.

  So `rows` equals the number of distinct `selection.row` of the table's `selectable` row items over all pages of an
  unfiltered `rowChanges`, and row filters do not change it. A client that selected rows one by one knows from it when
  it has selected all of them. One exception: a pair whose only stored difference is a computed value (a formula
  output that a native foreign-key rewrite left stale, partial-changes-v1 §5.2, or a write below the native
  validation) makes `tableData` present and counts, while its row item is `computed` and it has no unit.

## 5. Row items

A row item (`DraftRowItem`, §9) is addressed by `tableId` (Draft id, else the Head id of a removed table),
`previousTableId` (Head id of a renamed table, on every row of it), `rowId` (Draft id, else the Head id of a removed
row) and `previousRowId` (Head id of a renamed row). It carries `changeType` (§3), `fields`, `columns`, `selection`,
and `idTakeover` / `idExchange` where they apply.

### 5.1 Row selection

In order of precedence:

1. `refused` with `code` — the table is refused.
2. `goesWith` the structure unit, reason `tableExistence` — the table was created, removed or replaced.
3. `selectable` — the row has units: `units` are its `rowCreate`, `rowDelete`, `rowReplace`, `rowRename`,
   `rowColumns` and `field` units in listing order; `row` is `{ rows: [{ tableId, rowId, side? }] }`, which selects
   all of them; `structure` is the table's structure unit when it has one. One item can hold several units (a rename
   with an edit); two items can share one unit (a replaced row). A deleted row whose id a rename took over carries
   `side: 'head'`.
4. `computed` — the row is among the changed rows of the catalogue but yields no unit: only computed values differ.
5. `goesWith` the structure unit, reason `structureBound` — the catalogue does not load the row because it differs
   only in changed fields or a structure-bound `publishedAt` (with or without `schemaHash`).

Every row selection carries `units`, empty unless `selectable`, so a client reads the units of any row without a
fallback to its state. A unit a change goes with is a `DescribedUnitRef`: a structure unit carries its
`structureChange`, so a row says "part of replacing the table" by itself. The catalogue of a page gets exactly the
pairs the listing would load for the page's unit row ids, also under filters, so the row units are those the listing
gives.

### 5.2 Field and column changes

`fields` lists the native field changes of the row (the native value diff of its Head and Draft data, after the
formula values of the page's rows are computed), in native order, each as one entry (`DraftFieldChange`):

| Field | Meaning |
| --- | --- |
| `path` | JSON Pointer of the changed value: a field, an array element (`/tags/1`), or the root `''`. |
| `changeType` | `FIELD_ADDED`, `FIELD_REMOVED` or `FIELD_MODIFIED`: the values of the native `RowChangeDetailType` that the value diff produces. |
| `oldValue`, `newValue` | The Head and the Draft value, as the native read computes them: the formula computation of the page's rows also gives a stored `null` of a typed field that type's value. A side without the value has `null`: `oldValue` of `FIELD_ADDED`, `newValue` of `FIELD_REMOVED`. |
| `selection` | The result of the field selector at `path` (partial-changes-v1 §4.3), resolved by the selection normalisation itself (below). |
| `follows` | The rename whose cascade rewrote this reference (§5.5). |

- A created row has one entry at the root pointer `''`: `FIELD_ADDED`, `oldValue: null`, `newValue` the whole row
  data; a removed row one `FIELD_REMOVED` entry with `newValue: null`. Its selection is that of any field of the row:
  `goesWith` the row's existence unit (`rowExistence`), or the structure for a created, removed or replaced table
  (`tableExistence`).
- An entry at an object pointer appears when one side has no object there: an array element that is an object
  (`/items/1`, `FIELD_ADDED` with the element), which selects the array's unit as below; a value of a field that a
  structure change added, removed or retyped, which goes with the structure (`structureBound`); or the root entry.
- The value diff does not follow schema moves: a field that a pending `move` patch carried reads as `FIELD_REMOVED` at
  its Head pointer and `FIELD_ADDED` at its Draft pointer, and both go with the structure (`structureBound`), whose
  `structureChange` reports the move (partial-changes-v1 §5.2).
- An array element reads at its own pointer, and its selection is the unit of the whole array (§3.2 of
  partial-changes-v1: arrays are atomic).

| Selector result | `selection` |
| --- | --- |
| `notSelectable` (a formula or system value), or no unit while the stored values at `path` are equal (a computed value inside an array or File value, which is atomic) | `{ state: 'computed' }` |
| requires the row's creation, deletion or replace unit | `goesWith`, reason `rowExistence` |
| requires the structure unit | `goesWith`, reason `tableExistence` for a created, removed or replaced table, else `structureBound` |
| selects a field unit, or requires the unit of the whole array or File value | `{ state: 'unit', unit }` |

A field of a refused table is `refused`. A changed formula field is `computed`, as its selector is, although the values
it computes travel with the structure unit.

`columns` lists, for a row on both sides, each differing column among `publishedAt`, `meta` and `schemaHash`
(`DraftColumnChange`: `column`, `oldValue`, `newValue`, `selection`). Each gets the unit that owns it in the catalogue
(partial-changes-v1 §3.1): the `field` unit of the published-at field or the `rowColumns` unit (`state: 'unit'`), or
`goesWith` the structure unit when the structure owns it or the row is not loaded.

### 5.3 Id takeover

A rename into the id of a deleted row (partial-changes-v1 §3.7) gives two items with one row id: the deleted row
(`REMOVED`, its deletion unit addressed with `side: 'head'`) and the renamed row. Both carry the same
`idTakeover: { deletion, rename }`: the deletion unit and the `rowRename` unit, with their selectors. The deleted
row's item names the row that took its id (`rename.rowId`, from `rename.previousRowId`); the rename's item names the
deleted row (`deletion.rowId`). Committing the rename requires the deletion (`idOccupied`), so a client offers it from
either item. A replaced row needs no link: its two items carry the same `rowReplace` unit. Rows of a refused, created
or removed table have no `idTakeover`.

### 5.4 Id exchanges

Renames can take each other's ids: in a swap `a ↔ b` row `a` is renamed to `b` and row `b` to `a`; a cycle
`a → b → c → a` goes over three rows. Each rename item that takes the Head id of another renamed row of its table
carries `idExchange: { renames, termination }`: `renames` are the `rowRename` units of the chain, its own first, each
taking the Head id of the next, at most 50; `termination` says what the last listed rename takes:

| `termination` | The last rename of `renames` takes |
| --- | --- |
| `cycle` | the Head id of the item's own rename: the list holds every rename of the cycle once |
| `freeId` | an id that no row held in Head |
| `deletedOccupant` | the Head id of a row deleted in the Draft, which `idTakeover` links to that rename |
| `truncated` | the Head id of another renamed row: the chain goes on past the 50 renames listed |

A commit of the item's rename requires the other renames of its list (`idOccupied`), with `deletedOccupant` also the
deletion, and with `truncated` more than the list shows. A rename into a free id or into the id of a deleted row has no
`idExchange`. The page follows each chain through the pairs it loaded, then, for the Head ids the walk reached and did
not load, through one bounded recursive query per table by row id and identity (never the table's link sets), and
adds the renamed rows to the page's catalogue, so a rename on another page is listed with its unit. One query then
reads the versions of every renamed row the page looked up, for §5.4 and §5.5 together.

### 5.5 References rewritten by a rename

A native row rename rewrites the references to the row in every referrer, so the referrers' field changes look like
edits. A field change whose Head value references a row and whose Draft value references the same row under its new
id carries `follows: { unit, reason: 'referenceRename' }`: the `rowRename` unit of that row, wherever it is paged. The
field keeps its own `selection`: the closure requires the rename for the field and the field for the rename
(partial-changes-v1 §6.6). It holds when the leaf at its pointer is a foreign key in the Head and the Draft schema
resolving to one table identity, and the Head value is the rename's previous id and the Draft value its new id, for
one row on both sides with different ids. A reference set by hand from the previous id to the new id reads the same,
with the same dependencies; one edited from another row, or to a row created at another id, does not follow a
rename. Array elements are compared by position. A rename in a refused table has no unit, so its referrers carry no
`follows`. The page finds the renames with one query per referenced table with changed rows, by row id and identity.

## 6. Summary

`changes.summary` returns (`DraftChangesSummary`, §9):

| Field | Meaning |
| --- | --- |
| `headRevisionId`, `draftRevisionId`, `refusedTables` | As every read. |
| `tablesSummary` | The listed tables by change type (§4): `total`, `added`, `modified`, `removed`, `renamed`, plus `replaced`, the number of replaced ids (each counted once; its two items are also counted in `added` and `removed`). |
| `rowsSummary` | The reported rows of every listed table by change type, as `rowsSummary` of the table items. |
| `rowsWithUnits` | The rows with units over all tables: the sum of the table items' `tableData.rows` (with its exception, §4). A client tells a user's own row edits from rows that only travel with a structure change by it. |
| `sharedSchemas` | Every shared schema unit: `{ sharedSchemaId, changeType, unit }`, `changeType` `ADDED` (no Head row), `REMOVED` (no Draft row) or `MODIFIED`. |
| `transientTables` | Every structure unit of tables created and removed inside the Draft: `{ tableId, changeType: 'ADDED', structure }`. |
| `viewsOnlyTables` | Every views unit of a table whose user table version is unchanged, which no table item shows: `{ tableId, changeType: 'MODIFIED', views }`. |
| `sharedSchemasCount`, `transientTablesCount`, `viewsOnlyTablesCount` | The lengths of the three lists before `filters`. |

A `RENAMED_AND_MODIFIED` item counts in `renamed` and in `modified`, so each count equals the `totalCount` of the
`changeTypes` filter of that type in `tableChanges`, and the row counts what `rowChanges` lists under that filter.
`filters` apply to the three lists by the rules of §7 over each item's `changeType` and id (`tableId`, or
`sharedSchemaId`), so the table items and the summary items of one filter form one list. The counts and the
`…Count` fields do not follow `filters`: they are the Draft's totals, which a client shows on its tabs, beside its
filter choices and in its empty state, from one call.

A transient table is `ADDED`: it has no Head side, and a commit adds its migrations to the Head ledger as for a created
table. A views-only table has one id and one version on both sides, so it is `MODIFIED`. No summary item is renamed.
Each list is ordered by its id (`sharedSchemaId` or `tableId`) in code-point order.

## 7. Order, paging and filters

**Order.** Tables by public id (Draft id, else Head id) by code point; of two items with one id, the table that exists
only in Head comes first: a replaced id's removed table before the table created at its id, and a removed table before
the renamed table that took over its id. Rows by their table in that order, then by row id (Draft id, else Head id) by
code point (`COLLATE "C"`). Of two items with one row id, the one whose row exists only in Head comes first: a replaced
row's deleted row before the row created at its id, and a deleted row before the rename that took over its id. The order
does not depend on internal ids, so copies of a project list their items in the same order. Within one read state,
`(tableId, changeType)` identifies a table item and `(tableId, rowId, changeType)` a row item.

**Paging.** Keyset pages: `after` is the `endCursor` of the previous page, an opaque cursor naming the last table, or
the last table and row id; offset cursors are refused. Every edge carries the cursor of its position; the two items of
one row id can share it. Row items that share a row id are never split across pages: a table's page is fetched
`WITH TIES`, so a row page can hold a few more items than `first`. `pageInfo.hasNextPage` says whether an item follows
the page. `tableChanges` returns `totalCount`, the number of tables matching its filters. `rowChanges` returns no total
(§8).

**Row filters** (`rowChanges`), applied after the anti-join, so they add no scan:

- `tableId` selects the rows of the table items that show that id, as the unfiltered list shows them: both tables of a
  replaced id, a created table by its Draft id, a removed table by its Head id, a renamed table by its Draft id. Only
  when no table item shows the id does it select the renamed table whose Head id it is (its rows carry it as
  `previousTableId`); a renamed table's Head id that another table holds now selects that table only.
- `changeTypes` matches the row's change type; `RENAMED` and `MODIFIED` also match `RENAMED_AND_MODIFIED`. An empty
  list matches nothing.
- `search` is a case-insensitive substring of the Head or Draft row id (a plain substring: `_` and `%` are not
  wildcards).

**Table filters** (`tableChanges`, `summary`): `changeTypes` follows the row rule over the table's change type (§4);
`search` is a case-insensitive plain substring of the table's Draft or Head id, so a renamed table is found by either
id and a removed one by its Head id. Table filters apply before paging, so `totalCount` and `hasNextPage` count the
matching tables only.

## 8. Cost

A call costs the compared snapshot, which every listing page reads, and one query per table it needs, over the
anti-join of the table's two link sets (a created or removed table reads the rows of its one version):

- **`rowChanges`** reads the tables in order from the cursor's table (only the filtered tables with `tableId`, and no
  created or removed table whose one change type `changeTypes` leaves out) and stops when the page is full: the query
  of a table returns its page pairs, whether a matching row of the table follows them, and the other reported pairs of
  the page's row ids that the filters leave out, which the page's catalogue loads (§5.1) and the page does not list.
  It returns no `totalCount`, so it reads no table before the cursor or after the full page, except when the page ends
  with the last matching row of its table: then it reads the next tables until one has a matching row, to tell
  `hasNextPage`. A filtered page that does not fill reads every table from the cursor's table on, one query each,
  whose cost is that of the unfiltered anti-joins; the operation timeout bounds it. The total of a list comes from the
  summary (`rowsSummary` per change type, `rowsWithUnits`) or from the table item (`rowsSummary`, `tableData.rows`). A
  `search` filter, and a `changeTypes` filter with several types, have no total: a `RENAMED_AND_MODIFIED` row counts
  in two types, so the per-type counts do not add up.
- **`tableChanges`** reads the row counts of the tables on its page (one query each) and of a renamed table off the
  page only when a `changeTypes` filter needs its change type (§4).
- **`summary`** reads the row counts of every listed table: the counts per change type and the number of rows with
  units.
- A row page then reads the row versions of its pairs, computes their formula values and builds the field diffs; its
  id exchanges and followed renames read by row id and identity (§5.4, §5.5).

No read joins every row of both revisions. Measured on the PoC in the sandbox, one table of 1,000,000 rows with 1,000
rows edited: a row page of 50 or 500 1.6–1.8 s, a table page 1.6 s, the summary 1.6 s, against 31–34 s through the
native diff. A table whose structure change rewrote all of its 100,000 rows: a row page 2.1 s, the summary 1.9 s.
Every page recomputes its tables' anti-joins; a cache of the Draft diff is out of scope.

## 9. TypeScript types

```ts
type ChangesBranch = { projectId: string; branchName: string };

type DraftTableChangesFilters = { changeTypes?: ChangeType[] | null; search?: string | null };
type DraftRowChangesFilters = DraftTableChangesFilters & { tableId?: string | null };
type DraftTableChangesInput = { branch: ChangesBranch; first: number; after?: string | null;
  filters?: DraftTableChangesFilters | null };
type DraftRowChangesInput = { branch: ChangesBranch; first: number; after?: string | null;
  filters?: DraftRowChangesFilters | null };
type DraftChangesSummaryInput = { branch: ChangesBranch; filters?: DraftTableChangesFilters | null };

type DraftReadState = { headRevisionId: string; draftRevisionId: string; refusedTables: RefusedTable[] };
type DraftPageInfo = { hasNextPage: boolean; endCursor: string | null };
type DraftTablePage = DraftReadState & { edges: Array<{ cursor: string; node: DraftTableItem }>;
  pageInfo: DraftPageInfo; totalCount: number };
type DraftRowPage = DraftReadState & { edges: Array<{ cursor: string; node: DraftRowItem }>;
  pageInfo: DraftPageInfo };

type DraftTableItem = {
  tableId: string;                       // Draft id, else the Head id of a removed table
  previousTableId?: string;              // Head id of a renamed table
  changeType: ChangeType;
  replaced: boolean;
  rowsSummary: RevisionChangeSummary;    // { total, added, modified, removed, renamed }
  schemaMigrations: SchemaMigrationDetail[];  // native shape
  viewsChanges: ViewsChangeDetail;            // native shape
  selection: TableSelection;
};
type TableSelection = RefusedSelection | ContentEqualSelection | SelectableTableSelection;
type RefusedSelection = { state: 'refused'; code: RefusalCode };
type ContentEqualSelection = { state: 'contentEqual' };
type SelectableTableSelection = { state: 'selectable'; structure?: DescribedUnitRef; views?: UnitRef;
  tableData?: { selector: SelectionItems; rows: number } };

type DraftRowItem = {
  tableId: string; previousTableId?: string;  // as table items
  rowId: string;                              // Draft id, else the Head id of a removed row
  previousRowId?: string;                     // Head id of a renamed row
  changeType: ChangeType;
  fields: DraftFieldChange[];                 // native field changes, in native order
  columns: DraftColumnChange[];               // publishedAt, meta, schemaHash of a row on both sides
  selection: RowSelection;
  idTakeover?: IdTakeover;
  idExchange?: IdExchange;
};
type DraftFieldChange = {
  path: string;                     // JSON Pointer; '' for the whole value of a created or removed row
  changeType: DraftFieldChangeType;
  oldValue: unknown;                // null when Head has no value
  newValue: unknown;                // null when the Draft has no value
  selection: FieldSelection;
  follows?: FollowedUnit;
};
type DraftFieldChangeType = 'FIELD_ADDED' | 'FIELD_REMOVED' | 'FIELD_MODIFIED';  // native RowChangeDetailType values
type DraftColumnChange = { column: RowColumn; oldValue: unknown; newValue: unknown; selection: FieldSelection };

type RowSelection = { units: UnitRef[] } & (   // the row's own units: empty unless selectable
  | RefusedSelection
  | GoesWithSelection
  | ComputedSelection
  | { state: 'selectable'; row: SelectionItems; structure?: UnitRef });
type FieldSelection = RefusedSelection | GoesWithSelection | ComputedSelection | FieldUnitSelection;
type GoesWithSelection = { state: 'goesWith'; unit: DescribedUnitRef; reason: GoesWithReason };
type ComputedSelection = { state: 'computed' };
type FieldUnitSelection = { state: 'unit'; unit: UnitRef };   // a field unit, or the unit of the whole array or File
type GoesWithReason = 'tableExistence' | 'structureBound' | 'rowExistence';

type FollowedUnit = { unit: UnitRef; reason: FollowReason };
type FollowReason = 'referenceRename';
type IdTakeover = { deletion: UnitRef; rename: UnitRef };
type IdExchange = { renames: UnitRef[]; termination: IdExchangeTermination };
type IdExchangeTermination = 'cycle' | 'freeId' | 'deletedOccupant' | 'truncated';

type DraftChangesSummary = DraftReadState & {
  tablesSummary: RevisionChangeSummary & { replaced: number };
  rowsSummary: RevisionChangeSummary;
  rowsWithUnits: number;
  sharedSchemas: ChangedSharedSchema[]; sharedSchemasCount: number;
  transientTables: TransientTable[]; transientTablesCount: number;
  viewsOnlyTables: ViewsOnlyTable[]; viewsOnlyTablesCount: number;
};
type ChangedSharedSchema = { sharedSchemaId: string; changeType: ChangeType; unit: UnitRef };
type TransientTable = { tableId: string; changeType: ChangeType; structure: DescribedUnitRef };
type ViewsOnlyTable = { tableId: string; changeType: ChangeType; views: UnitRef };
```

`ChangesBranch`, `SelectionItems`, `UnitRef`, `DescribedUnitRef`, `RowColumn`, `RefusedTable` and `RefusalCode` are
those of partial-changes-v1 §5.11. `ChangeType`, `RevisionChangeSummary`, `SchemaMigrationDetail` and
`ViewsChangeDetail` are the native diff types, exported under these names; `DraftFieldChangeType` holds the values of
the native `RowChangeDetailType` that the row value diff produces, and the package exports that enum too. Every code
union has a runtime list next to it, from which the type is derived (partial-changes-v1 §5.10):
`TABLE_SELECTION_STATES`, `ROW_SELECTION_STATES`, `FIELD_SELECTION_STATES`, `GOES_WITH_REASONS`, `FOLLOW_REASONS`,
`ID_EXCHANGE_TERMINATIONS`.

## 10. Acceptance scenarios

Reachability and oracles (properties over random Drafts):

- DR-01 Every unit that `changes.list` returns is reachable from the three reads, and nothing else: structure and
  views units from table items or the summary, shared schemas from the summary, row and field units from row items,
  `rowColumns` units from row items and columns, including the units of `idTakeover`, `idExchange` and `follows`.
- DR-02 Every reported table, row, field and column without a unit says why: `goesWith`, `computed`, `contentEqual`
  or `refused`.
- DR-03 Native oracle: on pages of 1, 2 and 7 rows, the reads list every row change of the native diff of the Draft
  against its Head with an equal change type (`RENAMED_AND_MODIFIED` for a renamed row that also differs in a row
  column, §3), the same field changes (paths as JSON Pointers, values equal), and beside them only rows that differ
  in `publishedAt`, `meta` or `schemaHash` (§3).
- DR-04 Table items equal the native table changes in change type and row counts, except a table with only rename
  migrations and no reported row, which may read `RENAMED`, and the row-column differences of §3; each item's `schemaMigrations`, replayed from the Draft
  ledger, take the table from its Head id to its Draft id in ledger order, each pending migration under one item at
  most and the rest forming transient tables (listed in the summary unless the catalogue joins them to the structure
  unit of a table created at their id); `viewsChanges` compare the views under the Head id in Head with those under
  the Draft id in Draft.
- DR-05 `tableData.rows` of every table equals the distinct `selection.row` of its `selectable` items over an
  unfiltered row read; the summary's `rowsWithUnits` equals their sum; a preview that selects `tableData: [table]` has
  a `coverage` entry with `rows` equal to `tableData.rows` (partial-changes-v1 §5.1), apart from the computed-only
  exception.
- DR-06 The summary equals the native summary in its counts and change types, apart from the row-column differences
  of §3; each count of `tablesSummary` equals
  the `totalCount` of the table filter of its type, and of `rowsSummary` the number of rows the row filter of its
  type lists.

Items:

- DR-07 Ids: a renamed table's items and rows carry `tableId` (Draft id) and `previousTableId` (Head id); a renamed
  row carries `rowId` and `previousRowId`; no item carries another table or row id outside `schemaMigrations`.
- DR-08 A replaced table id gives two adjacent items, `REMOVED` then `ADDED`, both `replaced: true` with one
  `replaced` structure unit; `tablesSummary.replaced` counts it once; a refused replaced id is still `replaced`.
- DR-09 A renamed table with nothing else changed is `RENAMED`; with a field change, another migration, a views change
  or a reported row it is `RENAMED_AND_MODIFIED`.
- DR-10 A table whose structure changed has no `views` in its selection, also when its views were edited, and its
  structure unit says `structureChange.views: true` exactly when its views document differs; a table without a
  structure change and with a views edit has `views`; a views-only table appears only in the summary; whenever
  `viewsChanges.hasChanges` is true, the table has a views unit or `structureChange.views: true`, except a replaced id
  whose two tables hold equal views documents (§4).
- DR-11 A `contentEqual` table and a `computed` row; a refused table's items, rows and fields are `refused` with its
  code; rows of a created, removed or replaced table go with the structure (`tableExistence`).
- DR-12 Field changes: paths are JSON Pointers (a nested field `/dims/width`, an array element `/tags/1`, which
  selects the array's unit); an added field or element has `oldValue: null`, a removed one `newValue: null`, and a value
  is the one the native read computes; a created row has one root entry `''`, `FIELD_ADDED` with the whole
  data, and a removed row one `FIELD_REMOVED`, both going with the row (`rowExistence`); a field moved by a pending `move` reads as removed and added, both `structureBound`; a formula
  field is `computed`; a value of a changed field goes with the structure (`structureBound`).
- DR-13 Columns: a `meta` and a `schemaHash` difference under an unchanged structure select the `rowColumns` unit; a
  `publishedAt` difference with a published-at field selects that field unit; under a changed structure the
  `schemaHash` goes with the structure, and a row that differs only there is not reported.
- DR-14 Id takeover on both items; id exchanges with each `termination` (a swap, a 3-cycle, a chain into a free id,
  a chain into a deleted row, a chain longer than 50); `follows` on a reference rewritten by a rename, also when the
  rename is on another page or filtered out, and not on a reference edited by hand to another row.

Paging, filters, validation, snapshot:

- DR-15 Paging until `hasNextPage = false` returns the same items as one large page, for pages of 1 to 5,000; the two
  items of one row id are never split; offset and foreign cursors are refused; `first` of 0, 5,001 or 1.5 is refused
  before the snapshot.
- DR-16 Row filters: `tableId` of a replaced id lists both tables' rows; of a renamed table's Head id lists it only
  when no item shows the id; `changeTypes` `RENAMED` and `MODIFIED` include `RENAMED_AND_MODIFIED`; `search` treats
  `_` and `%` literally.
- DR-17 Table filters select the same items from `tableChanges` and the summary lists and leave the summary counts and
  `…Count` fields unchanged; `totalCount` and `hasNextPage` count matching tables only.
- DR-18 Snapshot: a Draft edit committed between a page's phases changes nothing the page returns (barrier tests for
  pairs, versions, exchanges and follows; a takeover reads nothing of its own, it comes from the page's pairs).
- DR-19 A row page reads only the tables from the cursor's table until it is full: with 100 changed tables and a page
  that fills in the first, the call runs one pair query.
- DR-20 `null` for every optional input is treated as absent; an unknown branch is the native not-found error.

## Changelog

### Version 1.5 (2026-11-10)

- §9: the package also exports the native `RowChangeDetailType`, whose values `DraftFieldChangeType` holds.
- Status: the reads are on the facade (ADR-002 PR 12, #145).

### Version 1.4 (2026-11-10)

- §8: the pair query of a filtered row page also returns the other pairs of the page's row ids, for its catalogue; the
  page reads no created or removed table whose change type `changeTypes` leaves out; a filtered page that does not fill
  reads every table from the cursor's table on.
- §1: a `search` holding the NUL character is a validation error, and a cursor whose row id holds it is malformed.
- Status: PR 11 (row filters) implemented; the Draft reads are complete.

### Version 1.3 (2026-11-10)

- §5.4: one query reads the versions of the renamed rows a page looked up for its id exchanges and followed references.
- DR-18: a takeover needs no barrier test of its own.
- Status: PR 10 (§5.3–§5.5) implemented.

### Version 1.2 (2026-11-10)

- §5.2, DR-12: values are those the native read computes, which gives a stored `null` of a typed field that type's
  value, so DR-12 no longer asks for a field set to `null`.
- §8: a row page whose last item ends its table reads the next tables until one has a reported row, to tell
  `hasNextPage`.
- §5.2: a field change that matches no unit while the stored values at its path are equal is `computed`: a formula or
  system value inside an atomic array or File value changes only in the computation.

### Version 1.1 (2026-11-10)

- §7: of two table items with one id, the table that exists only in Head comes first, instead of an order by table
  identity, which is an internal id; so DR-08's `REMOVED` then `ADDED` holds and copies of a project page alike. An
  empty `changeTypes` matches nothing.
- §3: `schemaHash` does not make a renamed row of a table with a changed structure `RENAMED_AND_MODIFIED`; the row
  columns are named as where the change types and counts depart from the native diff, and DR-03, DR-04 and DR-06
  carry that exception.
- DR-04: transient migrations that the catalogue joins to the structure unit of a table created at their id are in no
  list.

### Version 1.0 (2026-11-10)

- Accepted from the PoC document `draft-diff.poc.md` (branch `poc/draft-diff`), with the changes of [ADR-002]: Draft
  items without the nested native payload (`change`), one id vocabulary (`previousTableId` / `previousRowId` instead
  of `fromTableId` / `fromRowId`), merged field changes with values and a JSON Pointer `path` instead of a native dot
  `path` beside a `pointer`, `columns` (was `columnChanges`), `replaced` and `tablesSummary.replaced`,
  `tableData: { selector, rows }` (was `tableData` and `tableDataRows`), selectors as `SelectionItems`, the summary
  without `revisionId`, `parentRevisionId` and `totalChanges`, with `rowsWithUnits`, and shared schema items with
  `sharedSchemaId` and `changeType` only (no `change`, no `SHARED_SCHEMA_CHANGES`); no
  `totalCount` on row pages; views units only for tables without a structure unit.

[ADR-002]: ../adr/ADR-002-draft-reads-and-public-changes-api.md
