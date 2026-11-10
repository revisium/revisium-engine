# ADR-002: Draft Reads and the Public API of Draft Changes

## Status

Accepted (2026-11-10)

Amends [ADR-001]: decision 3 (a views edit of a table whose structure changed is part of its structure unit), the
module table (the Draft reads belong to `partial-changes`, not to `revision-changes`) and the consequence on remaining
counts (results no longer count remaining units).

## Date

2026-11-10

## Context

### Problem

[ADR-001] built partial commit and revert; master has the four operations (`listChanges`, `previewChanges`,
`commitChanges`, `revertChanges`) but no facade and no package export, so nothing of their API is released. A
prototype then put them in front of people: engine branch `poc/draft-diff` (`ddb22c6`, the facade of draft PR #145
plus Draft reads), core `poc/partial-changes` (`c86460f`, GraphQL) and admin `poc/partial-changes` (`d842f94`,
selection inside Tables and Row Changes). Three users did 13 of 15 tasks fully through the UI, and every commit and
revert matched its preview.

The prototype also showed where the clients had to compensate for the API. Each item below is visible in the PoC code:

- **Untyped selection.** Core passes selections, selectors, `unmatched`, `estimate` and `renumbered` as JSON scalars,
  because `tables: Array<string | { tableId, side? }>` cannot be a GraphQL input type. The admin redeclares the
  engine types and casts, and one selector says `side: "head"` while a unit ref beside it says `HEAD`.
- **Two id vocabularies in one item.** A Draft table item has `tableId` (Draft id) and a nested native `change` whose
  `tableId` is the Head id of a renamed table; row items say `fromTableId` / `fromRowId` while units say
  `previousTableId` / `previousRowId`. The admin extracts row ids through the native variants and joins field
  selections to native field changes by a path string.
- **Reasons whose place changes meaning.** `Reason { tableId, rowId?, path? }` is the referring value for one code, the
  selected value for another and a table schema for a third. The admin guesses the referenced entity from the kind of
  the required unit, which is wrong when a structure unit owns a row reference.
- **Counts that look measured but are not.** A plan stopped by a limit returns `fingerprint: ''`, zero counts and
  `unmatched: {}`, which reads as "everything matched" (the admin confirmed kept rows from it after STALE).
  `remaining` counts only the tables the plan read, so "n stay in the Draft" was false in the walkthrough. The panel
  cannot tell whether a table's row changes are all in the plan.
- **Deferred fields without values**, **a replaced table inferred from two items**, **exported names that clash**
  (`TableChange` and `FieldChange` are both partial-change classifications and native diff payloads).
- **`stale` says nothing**, so after STALE the UI cannot say what changed, and a kept selector that no longer matches
  surfaces only in the next preview.
- **Every Draft row page counts every changed table** for `totalCount`, which costs one count query per changed table
  per page.

An architecture review (Fable, 2026-11-10) added two simplifications: views carry their own selection kind and
re-migration path although a view edit held back from a schema change of the same table is rare, and the
`rowColumns` selector is hard to reason about.

## Decision

The public API of the `changes` namespace is frozen in the following shape before anything is released. The exact
contract is in [partial-changes-v1](../specs/partial-changes-v1.spec.md) v2.0 (§3.6, §4, §5, §9) and the new
[draft-reads-v1](../specs/draft-reads-v1.spec.md).

1. **Draft reads are part of `partial-changes`.** `changes.tableChanges`, `changes.rowChanges` and `changes.summary`
   read the compared snapshot that the listing reads and one query per changed table (the anti-join of its two link
   sets), never the native diff queries, which join every row of both revisions (1.6–1.8 s per page at 1M rows
   against 31 s). They annotate every table, row, field and column change with how it is selected, derived from the
   change catalogue, so no client re-implements ownership. Native `revisionChanges`, `tableChanges` and `rowChanges`
   stay for history and compare and do not change.
2. **Draft items have their own shape and one id vocabulary.** Tables and rows are addressed everywhere (units,
   items, reasons, coverage) by `tableId` (Draft id, else Head id), `previousTableId` (Head id of a renamed table),
   `rowId` and `previousRowId`. Draft items do not nest native diff payloads: a table item carries its change type,
   row counts, migrations and views changes; a row item carries its change type and one list of field changes, each
   with its values, its JSON Pointer and its selection. Paths are JSON Pointers at every boundary.
3. **One typed selection language.** Every selection field is a list of one shape: `structures` (was `tables`, objects
   only), `tableData`, `views`, `sharedSchemas`, `rows`, `rowRenames` (was `renames`), `rowColumns`, `fields`, plus
   `all` and `exclude`. Every selector a result returns, `unmatched` included, uses the same vocabulary. A unit has
   exactly the fields of its kind; a shared schema unit carries `sharedSchemaId`, not a `tableId` holding that id.
   Code values are the engine's code lists; a transport maps each list to one spelling and passes no engine-typed
   value as an untyped scalar.
4. **Reasons name their participants.** A required reason has a `site` whose kind fixes its meaning (a selector, a
   row value, a table schema, a pending migration, a row id or a table id), the entity the site `references` for
   reference codes, and a `cause` (the applied unit whose application needs the unit, and its role), replacing the
   PoC's `by` / `byRole`.
5. **Plans say what they computed.** A preview stopped by a limit says `planned: false` and returns no fingerprint,
   counts or `unmatched` instead of empty values. `remaining` and `unreadTables` are removed; an applied result says
   whether the Draft still has changes (`draftHasChanges`, the native `hasChanges` the writer recomputes). A preview
   returns per-table coverage of the plan (structure, views, rows wholly and partly applied).
6. **Deferred fields carry the value the commit writes** (and omitted paths are objects, so a reason can be added
   later), and **a replaced table is flagged** on its items and counted in the summary.
7. **Exported names do not clash.** Partial-change classifications get `Structure…` names, generic nouns a `Plan…`
   prefix, selection-state variants a `…Selection` suffix; native diff payload names are not reused.
8. **Views follow the structure.** A table whose structure changed has no `views` unit: its views document, independent
   edits included, belongs to its structure unit. A `views` unit exists only for a table without a structure unit,
   where both sides have the same structure. A structure unit says whether it carries a views change
   (`structureChange.views`). This removes the views re-migration between sides, the views-against-structure closure
   check, the reason `viewsDoNotFitStructure` and the role `counterpart`.
9. **`rowColumns` stays a public unit kind and selector.** The unit is needed: every Draft difference belongs to a
   unit ([REQ-001.BR-003]); `meta`, `publishedAt` and `schemaHash` are row content that reads expose (the row API
   returns them, and the `RowPublishedAt` and `RowSchemaHash` system fields put them in row data) and the ledger scan
   reads `schemaHash`, so they stay compared (SPEC §3.1);
   and every unit needs an exact selector, which programs and agents use and a `requiredExcluded` blocker names
   ([REQ-001.BR-001]). It is documented as the technical columns of a row, which `rows` and `tableData` include.
10. **`stale` says what changed.** The fingerprint carries separate digests of the revisions, the applied unit set and
    their content behind a version prefix, so a `stale` result lists what differs (`version`, `operation`,
    `revisions`, `units`, `content`) with the current revision ids and `unmatched`.
11. **Totals once.** A Draft row page has no `totalCount`; totals come from the summary (per change type, and the rows
    with units) and from the table items (per table). A row page reads only the tables it lists.

### Boundaries

In scope: the engine contract of the seven `changes` operations and the transport rules of SPEC §5.10. Out of scope,
for a later minor version (additive): structured blocker details, item and unit keys, a Draft read token, a pageable
resolved plan, a light table-options query, and `omitted` reasons. The discriminated unit and object `omitted` paths
come now, because they would break later. Not acted on: freshness that covers only the applied units (documented) and native versus Draft
`changeTypes` filter semantics (native).

## Specification

- **[partial-changes-v1.spec.md](../specs/partial-changes-v1.spec.md)** v2.0: selection, units, reasons, results,
  fingerprint, transport rules and types.
- **[draft-reads-v1.spec.md](../specs/draft-reads-v1.spec.md)**: the three Draft reads.

### Quick Reference

```text
changes.preview({ branch, operation: 'commit',
                  selection: { structures: [{ tableId: 'products' }], rowRenames: [{ tableId: 'tags', rowId: 't2' }] } })
  → { status: 'required', planned: true, fingerprint, counts: { selected, required }, coverage, required: [
        { unit, reason: { code: 'idOccupied', site: { kind: 'rowId', tableId: 'tags', rowId: 't1' },
                          cause: { unit, role: 'taker' }, because } }], … }
changes.commit({ branch, selection, includeRequired: true, expected: fingerprint })
  → { status: 'stale', changed: ['content'], headRevisionId, draftRevisionId, unmatched }
changes.rowChanges({ branch, first: 50, filters: { tableId: 'products' } })
  → { edges: [{ cursor, node: { tableId, rowId, previousRowId, changeType, fields: [{ path, changeType, oldValue,
        newValue, selection }], columns, selection } }], pageInfo, headRevisionId, draftRevisionId, refusedTables }
```

## Modules and Interactions

| Engine feature | Change |
| --- | --- |
| `partial-changes` | Gains the Draft reads (compared snapshot, per-table pair queries, item builders, filters, cursors). Selection parsing, reasons, plan results and the fingerprint change shape; the views fit check and the views re-migration are removed. |
| `revision-changes` | Unchanged. Its field-diff and migration and views mappers are reused by the Draft reads as building blocks. |
| `draft-revision` | The commit and revert writers also return the Draft's `hasChanges` they recompute, for `draftHasChanges`. |
| Engine facade | `changes` namespace with `list`, `preview`, `commit`, `revert`, `tableChanges`, `rowChanges`, `summary` (draft PR #145 rebased). |

## Alternatives Considered

- **Draft reads over the native diff** (the PoC's first round): 31 s per page at 1M rows, and table details looked up
  by table id lose a renamed table's history. Rejected.
- **Keep the native payload in Draft items with documented precedence of the top-level ids**: the clients keep two
  vocabularies and a path join; the bug class the review found (grouping a renamed table under its old id) stays.
  Rejected. Exposing the full Head and Draft row records was also rejected: the clients use only ids and field values,
  and a row read by id gives the rest.
- **Keep `string | object` table refs and JSON scalars at the transport**: no code generation or validation of
  selections. Rejected. Opaque unit keys instead of selectors: clients must merge selections and exclusions, which
  needs the selector vocabulary; keys may be added later beside selectors.
- **Per-code reason unions**: the site kind already fixes the meaning, and a code can arise at two kinds of site
  (`structureBoundData` at a selector or a row value). Rejected.
- **A `remaining` with qualifiers** (known units, unread and refused tables, complete or partial): a number that is
  not what a user reads as "what stays". **A full recount after apply**: reads every table. Both rejected; the summary
  is the count of what stays.
- **Views independent of structure** (status quo): keeps a selection kind's semantics, a reason code, a role and a
  re-migration path for a rare case (committing a view edit while holding back a schema change of the same table).
  Rejected.
- **Fold `rowColumns` into `rows`**: a `rowColumns` unit would have no exact selector, so it could not be excluded or
  named by a blocker, and the listing's exact-selector invariant would break. **Stop comparing `schemaHash` under an
  unchanged structure**: reads expose it, so a Draft difference would have no unit, and a relink (SPEC §6.7) could
  replace the Draft's row version by the Head's and change what reads return without any unit applied. Both
  rejected.
- **`stale` with the whole new plan**: doubles the payload of an outcome that the client follows with a preview
  anyway. **An unstructured fingerprint**: cannot say what changed. Rejected.

## Consequences

### Positive

- Core can type every engine value; the admin drops its redeclared types, casts, path joins and id extraction.
- A client explains every requirement from the reason alone, and every STALE from its result.
- A plan never shows a value it did not compute.
- Draft row pages cost the tables they list, not every changed table.
- Less module surface: no views re-migration, no views fit check, one reason code and one role fewer.

### Negative

- The core and admin PoC branches adapt to every item before the stand re-walk.
- A view edit can no longer be committed or reverted while the schema change of the same table stays in the Draft.
- A Draft row list shows no total under a `search` filter or a `changeTypes` filter with several types (a
  `RENAMED_AND_MODIFIED` row counts in two types); other filters take their totals from the summary or the table
  item.
- `defaulted` values repeat per deferred row.

### Neutral

- Nothing released changes: the operations were never exported.
- `rowColumns` units keep appearing for rows that a native table rename left with an old `schemaHash` (native
  backlog item).

## Implementation Details

### Client migration

The core and admin PoC branches adapt once, after the facade PR; nothing released changes.

| Decision | Core (GraphQL) | Admin |
| --- | --- | --- |
| 1, 2, 11 | Own Draft models instead of the native `TableChangeModel` / `RowChangeUnion` in Draft items; `previousTableId` / `previousRowId`; merged field changes; `columns`; no row `totalCount`. | Row and table list items read top-level ids and the merged `fields`; the path join and the native id extraction go; row totals come from the summary and the table item. |
| 3 | Typed `DraftSelectionInput` and output `DraftSelectionItems` instead of `JSON`; enums from the code lists for `side`. | Generated types instead of the redeclared `Selection` and casts; `structures`, `rowRenames`; `__typename` dropped before sending a selector back. |
| 4 | `RequiredReason` with a `site` union, `references` and `cause`. | Cause and referrer wording read `site`, `references` and `cause` instead of inferring from the unit kind. |
| 5 | `planned`, nullable `fingerprint` / `counts` / `unmatched`, `coverage`, `draftHasChanges`; typed `estimate`. | The refused-before-matching guard reads `planned`; table checkboxes after a preview read `coverage`; "stays in the Draft" reads the summary; `draftHasChanges` drives the empty-Draft state. |
| 6 | `defaulted { path, value }`, `replaced`, `tablesSummary.replaced`. | Deferred lines show the value; "Replaced" and the table count read the flag and the count. |
| 7 | Imports the renamed types; no name clash with its native diff models. | — |
| 8 | Drops `counterpart` and `viewsDoNotFitStructure` from its enums (they come from the lists). | A views control only for tables without a structure change; the structure control says it includes the views. |
| 9 | — | — |
| 10 | `stale` with `changed`, ids and typed `unmatched`. | After STALE: say what changed and offer to drop the unmatched kept selectors. |

### Delivery

Small TDD PRs on engine master, in this order; each changes the SPEC section it implements from "pending" to done.

| PR | Content | Acceptance |
| --- | --- | --- |
| 1 | Selection vocabulary: `structures` with object refs, `rowRenames`; returned selectors and `unmatched` as `SelectionItems`; units discriminated by kind with `sharedSchemaId`; renamed code lists and types. | AS-80 |
| 2 | Views follow the structure: views unit only without a structure unit; `structureChange.views`; `views` selector of a table with a structure unit requires it; views fit check, re-migration, `viewsDoNotFitStructure` and `counterpart` removed; `invalidViews` from target validation. | AS-82, AS-83 |
| 3 | Structure descriptions from the PoC: `annotated` fields and objects with `annotations`. | AS-60c |
| 4 | Reasons: `site`, `references`, `cause`. | AS-84, AS-85 |
| 5 | Deferred rows: `defaulted` with values, `omitted` as objects. | AS-86 |
| 6 | Plan results: `planned` (preview and `blocked`), `counts` without `remaining`, `coverage`, `draftHasChanges` (the writers return `hasChanges`), `renumberedMigrations`. | AS-87 – AS-89 |
| 7 | Fingerprint in parts with a version prefix; `stale` with `changed`, ids and `unmatched`; malformed `expected` refused. | AS-90, AS-91 |
| 8–11 | Draft reads in four PRs: table items and summary; row items with fields and columns; id takeovers, exchanges and followed renames; filters and keyset paging. | DR-01 – DR-20 |
| 12 | Facade #145 rebased: the `changes` namespace and package exports; e2e. | AS-81, AS-92 |
| 13 | `docs/api.md`. | — |

Core (GraphQL on the PoC branch, then upstream) and the admin adapt after PR 12, then an Astra review and a short
re-walk of the three users' tasks on the stand. The API is frozen after the re-walk.

## Related

- [ADR-001]: amended as stated in Status.
- [REQ-001]: [REQ-001.BR-001] (one contract for people, programs and agents), [REQ-001.BR-003], [REQ-001.BR-009]
  (reads and selection are engine primitives; selection UX stays in the clients).

[ADR-001]: ADR-001-partial-commit-and-revert.md
[REQ-001]: ../requirements/REQ-001-partial-commit-and-revert.md
[REQ-001.BR-001]: ../requirements/REQ-001-partial-commit-and-revert.md
[REQ-001.BR-003]: ../requirements/REQ-001-partial-commit-and-revert.md
[REQ-001.BR-009]: ../requirements/REQ-001-partial-commit-and-revert.md
