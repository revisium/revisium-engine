# Schema Ledger Backfill Specification v1

## Overview

| Property | Value |
| --- | --- |
| Version | 1.2 |
| Status | Accepted |
| Date | 2026-11-10 |
| Parent ADR | [ADR-001](../adr/ADR-001-partial-commit-and-revert.md) |
| Requirements | [REQ-001](../requirements/REQ-001-partial-commit-and-revert.md): REQ-001.BR-002, REQ-001.BR-004, REQ-001.BR-005 |
| Depends on | [partial-changes-v1](partial-changes-v1.spec.md) §6.10, §6.13, §8.4, §10; [async-row-migration-v2](async-row-migration-v2.spec.md) §5, §6, §7, §13 |
| Code baseline | engine master `7f2d67d`; paths are under `src/features/` unless they start with `src/` |

This specification adds `backfillSchemaLedger`, a maintenance operation that gives a branch without a migration ledger
one, so that partial commit and revert stop refusing its tables. It is the first fix of the data doctor; the checks are
the existing scan (`scanSchemaLedger`, async-row-migration-v2 §5) and the repair (`repairSchemaLedger`, §6) is the
second fix.

**The decision.** For a branch whose Head has no migration table, one operation writes a new commit whose only change
is a migration table holding an `init` for every Head user table (plus `update` entries that close foreign-key cycles).
The Draft keeps its content and links the same migration table. It replaces the proposal of async-row-migration-v2 §7
and decides its question 2 (§13): projects without a migration table get a ledger rather than an exemption. The write
reuses the partial-commit writer unchanged: the migration table is created in the Draft first and then committed alone.

## 1. Problem

The migration ledger (rows of the system table `revisium_migration_table`) appeared in core v2.0.0 (2025-08-02). Core
creates the table only for a new project (`create-project.handler.ts` in core); a project cloned with `fromRevisionId`
links the source revision's tables as they are. Native writers record nothing when the table is missing: they log and
return `false` (`draft/commands/handlers/migration/base-migration.handler.ts:37-57`). So a project created before
v2.0.0, and every clone of one, has no ledger at all, even for schema changes made after v2.0.0.

Partial operations need the ledger to tell recorded schema changes from damage (partial-changes §6.10, §10). Without
the table every user table is unledgered, every partial operation on the branch is refused with `unledgeredTable`, and
only exactly `{ all: true }` works. The scan reports these branches as `unledgeredTable` with
`reason: 'noMigrationTable'` (`migration/ledger-scan/schema-checks.ts:47-48`). Such projects exist in production.

**Out of scope: unledgered tables in a branch that has a migration table.** `createTable` always writes an `init` when
the table exists (`create-schema.handler.ts:108-116`), so such a table arises only from damage or a manual edit, never
from the v2.0.0 upgrade. The scan reports it (`noLineage` or `brokenLineage`) and partial operations keep refusing it.
A backfill there would have to place an `init` before the table's earliest entry, that is, insert into published
history, which neither replicas nor the ledger rules allow (`applyMigrations` refuses an id at or before the last
`publishedAt`).

**Rejected: exempting such branches from the refusal.** Without a ledger the module cannot tell a recorded schema
change from an unrecorded one, so every structure change would be refused instead; and the project would never export
migrations. Creating the ledger once makes the branch an ordinary one: native writers record from then on.

## 2. Operation `backfillSchemaLedger`

A facade method of `EngineApiService` beside `scanSchemaLedger` and `repairSchemaLedger`, implemented by the
`migration` feature. The host exposes it to administrators. No permission layer in the engine.

| Input | Type | Required | Meaning |
| --- | --- | --- | --- |
| `projectId` | string | yes | The project. |
| `branchName` | string | yes | The branch whose Head gets the ledger. |
| `dryRun` | boolean, default `false` | no | Plan and return the entries; write nothing. |
| `comment` | string | no | The commit comment; default `Backfill the schema ledger`. |

An optional input given as `null` is treated as absent (as in async-row-migration-v2 §5.2). Wrong input types are
refused before any transaction, as partial-changes §5.9 does.

**Result** — one of:

| `status` | Fields | Meaning |
| --- | --- | --- |
| `notNeeded` | `headRevisionId`, `draftRevisionId` | The Head already has a migration table. Nothing is written. |
| `planned` | `headRevisionId`, `draftRevisionId`, `entries` | `dryRun`: what a run would write now. |
| `backfilled` | `previousHeadRevisionId`, `headRevisionId`, `draftRevisionId`, `entries` | The commit is written. |
| `refused` | `headRevisionId`, `draftRevisionId`, `refusal: { code, tableIds, message }` | Nothing is written. |

`entries` is the planned ledger in id order: `{ id, changeType: 'init' | 'update', tableId, hash }[]`, where `hash` is
the entry's own `hash` (the hash of the table's schema after the entry). The ids of a `planned` result are provisional:
they come from the clock (§3 step 3), so a later run writes the same entries under later ids.

| Refusal `code` | When | What the caller does |
| --- | --- | --- |
| `draftStructureChanged` | The Draft creates, removes or renames a user table; a user table's Draft schema row differs from Head in `data` or in its history (`meta`); or the Draft links a migration table that the Head does not. Those changes were made without a ledger, so no pending entry could explain them. `tableIds`: the tables concerned (Draft id, else Head id, as partial-changes blockers name them), or `revisium_migration_table`. | Commit or revert the changes natively, then run again. A Draft migration table is only reverted: committing it would give the Head an empty ledger, and every table would stay unledgered (§1, out of scope). |
| `schemaNotReproducible` | The planned ledger cannot reproduce every Head schema (§3 steps 3–4): a foreign key names a table that is not a Head user table, a Head user table has no schema row, a Head table id or schema fails the current rules (table id, meta-schema, `$ref`, field names, formulas), or no table of a foreign-key cycle survives the split. `tableIds`: the failing tables; for a cycle, its tables. | Fix the schemas natively and commit, then run again. For a cycle: a native `updateTable` of one table of each named cycle stores its whole schema in the form the replay produces (`SchemaTable.getSchema`, `draft/commands/handlers/update-table.handler.ts:94-128`). That form also resets every `default` of the table to `''`, `0` or `false`, so the operator checks the defaults first; another remedy is to remove one foreign key of the cycle. |

Errors as the partial operations:

- unknown project or branch;
- `MigrationLockedException` (`MIGRATION_LOCKED`, HTTP 423) while an async migration is active on the branch, for a
  dry run too;
- `BranchWriteFencedException` (`BRANCH_WRITE_FENCED`, HTTP 423) when a wait for the branch write fence exceeds its
  limit (partial-changes §8.4);
- `OperationTimeoutException` (`OPERATION_TIMEOUT`, HTTP 408) after `PARTIAL_CHANGES_OPERATION_TIMEOUT_MS`.

## 3. Algorithm

**Transactions.** A dry run plans in one read-only Repeatable Read transaction without the fence
(`OperationTransactionRunner.runPlanning`) and checks the migration lock, as the repair plans
(`RepairStateReader.readUnlockedBranch`). A run plans and writes in each attempt, as a partial commit does
(`partial-changes/writing/change-applier.ts`): `OperationTransactionRunner.runWrite` with
`DraftWriteAdmissionService.admitBranchWrite` first in every attempt. So an attempt takes the branch write fence shared
and checks the migration lock; after 2 consecutive serialization failures each further attempt runs under its own
exclusive holder (partial-changes §8.4). The attempt cap and timeout are those of partial operations
(`PARTIAL_CHANGES_MAX_ATTEMPTS`, `PARTIAL_CHANGES_OPERATION_TIMEOUT_MS`). Each attempt starts again from step 1.

1. **Read** the Head and Draft revisions of the branch, their tables and schema rows. If the Head links a migration
   table → `notNeeded`.
2. **Check the Draft.** If the Draft links a migration table → `refused` with `draftStructureChanged`. Compare the user
   tables (`system: false`) of Draft and Head by `createdId`: a table on one side only, a different table id, or a
   schema row that differs in `data` or `meta` → `refused` with `draftStructureChanged`. Partial-changes §3.4 counts
   each of these as a structure change; a schema changed and changed back still has a longer history. Row changes,
   views and shared schemas are allowed and kept.
3. **Plan the entries** for the Head user tables:
   - *Validate first.* A Head user table without a schema row, or whose id or Head schema fails the checks the replay
     makes on an `init` (table id rules; `NativeSchemaRules.ensureValidSchema`: meta-schema and formulas; field names),
     → `refused` with `schemaNotReproducible`. The toolkit calls below throw on such schemas (an unknown `$ref`, a
     `required` name without a property); any error they raise for a table also refuses it this way.
   - *References* of a table: the foreign-key targets of its Head schema as the replay reads them
     (`NativeSchemaRules.foreignKeysOf`: nested objects and array `items` included), minus the table itself. A target
     that is not a Head user table (missing, or a system table) refuses the table in this pass, so the tables that
     reference it are not named.
   - *Order.* Repeat until every table is emitted; *remaining* means not emitted yet:
     1. If some remaining table has every reference emitted, emit the one with the smallest id (code-point order) as an
        `init` with its Head schema row `data` as `schema`.
     2. Otherwise every remaining table waits on a remaining table, so some lie on a cycle: they reach themselves
        through references to remaining tables. Among those cycle members, take the smallest id whose Head schema
        survives the split below, and emit its `init` with `foreignKey` removed from every subschema that references a
        remaining table. If no cycle member survives → `refused` with `schemaNotReproducible` and the cycle members.
   - *Split.* The `update` for a table emitted by rule 2 holds one `replace` patch per stripped subschema, at its JSON
     Pointer (for example `/properties/tags/items`), with the Head subschema as `value`, patches in code-point order of
     the pointers. A table survives the split when `NativeSchemaRules.patchedSchema(initSchema, patches)` equals its
     Head schema (`schemasEqual`). That call rebuilds the whole schema (`SchemaTable.getSchema`): it sorts `required`,
     drops `readOnly: false`, `deprecated: false` and `description: ""`, and resets every `default` to `''`, `0` or
     `false`, while `createTable` stores the schema as given. So a schema with a non-empty default, or one created
     through the API and never updated natively, may not survive.
   - All `update` entries follow every `init`, in table-id order.
   - Shapes as native writers produce them (`share/schema/table-migrations-schema.ts`):
     `init` = `{ changeType: 'init', id, tableId, hash, schema }` with `hash = objectHash(schema)`;
     `update` = `{ changeType: 'update', id, tableId, hash, patches }` with `hash` = the hash of the schema after its
     patches, which is the Head schema's hash. Each entry passes `validateTableMigrationsSchema`, as native writers
     check (`base-migration.handler.ts:40-47`).
   - Ids: the first entry gets `nextNativeMigrationId({ id: null, publishedAt: null })`
     (`share/ledger/native-migration-id.ts`), that is, the current time; each next entry gets
     `nextNativeMigrationId({ id: previous, publishedAt: publishedAtOf(previous) })`. So the ids are distinct,
     increasing and no earlier than the clock.

   Examples (each arrow is a foreign key; `z` has none):

   | References | Entries |
   | --- | --- |
   | `a → b`, `b → a` | `init a` (without `b`), `init b`, `update a` |
   | `a → b`, `b → c`, `c → a` | `init a` (without `b`), `init c`, `init b`, `update a` |
   | `a → b`, `b → a`, `b → c`, `c → b` | `init a` (without `b`), `init b` (without `c`), `init c`, `update a`, `update b` |
   | `a → b`, `b → a`, `a → z` | `init z`, `init a` (without `b`, with `z`), `init b`, `update a` |
   | `a → c`, `c → d`, `d → c` | `init c` (without `d`), `init a`, `init d`, `update c` |
   | `a → b`, `b → a`, `a` does not survive the split | `init b` (without `a`), `init a`, `update b` |

4. **Verify** by the ledger replay (`share/ledger-replay`): replaying the planned entries from an empty state must give
   every Head user table an intact slot that reproduces its Head schema row (`checkTableSlot` → `reproduces`). The
   replay applies the current rules (meta-schema, field names, formulas, foreign-key targets). Otherwise → `refused`
   with `schemaNotReproducible` and the failing tables. An entry that fails `validateTableMigrationsSchema` refuses its
   table the same way.
5. If `dryRun` → `planned`; nothing is written.
6. **Write** in the same attempt, with existing primitives and no change to the writer:
   1. Create the migration table in the Draft with `SystemTablesService.ensureSystemTable(draftRevisionId,
      SystemTables.Migration)`, as the first views save creates `revisium_views_table`: a new table version with new
      `versionId` and `createdId`, `system: true`, `readonly: false`, `createdAt` = the time of the write.
   2. Add one row per entry with `DraftRevisionApiService.createRows`, as the repair records its migrations
      (`RepairWriter.recordRepairMigrations`): `rowId = id`, `data` = the entry, `schemaHash` =
      `JsonSchemaValidatorService.tableSchemaHash`, `publishedAt = publishedAtOf(id)`. The handler sets new `versionId`
      and `createdId`, `hash = objectHash(data)`, `meta = {}`, `readonly: false` and `createdAt` = the time of the write
      (`draft-revision/commands/handlers/draft-revision-create-rows.handler.ts`).
   3. Commit with `DraftRevisionTargetApiService.commitToTarget` and a plan of one table, `revisium_migration_table`:
      `headVersionId` absent, `draftVersionId` = the new version, target `{ kind: 'linked', versionId }` with that
      version, `relinkCandidate: false`; `branchId`, the Head and Draft revision ids, and `comment`. By partial-changes
      §6.13: step 1 marks the Draft version readonly with its rows as it is linked into Head (`lockLinkedIntoHead`);
      tables not in the plan keep their links (`CommitTransition.relinkedTablesOf`), so the new Head (the former Draft
      revision) links the Head's table versions plus the migration table; step 2 gives the new Draft the Draft's table
      versions, the migration table among them; step 7 recomputes `hasChanges` from the table versions of the new Head
      and the new Draft.
7. **Verify the stored state**, as the repair does (async-row-migration-v2 §6.4), reading the new revisions: the new
   Head and the new Draft link the same migration table version, readonly; its rows are readonly and are exactly the
   planned entries, in id order, under strictly increasing ids; replaying them reproduces the schema row of every Head
   user table (`checkTableSlot` → `reproduces`), which is the predicate the head-schema check of partial-changes §6.10
   applies to a Head table, so that check refuses none. A failure rolls back and raises an error (a defect, not an
   outcome) whose message starts with `The backfilled ledger`.

After the transaction commits, endpoints of the new Head and the new Draft are notified, as partial-changes §6.13 step
8 says. Nothing is notified for a rolled-back attempt, a dry run, `notNeeded` or `refused`. A caller that repeats a
call whose response was lost gets `notNeeded`.

A Head without user tables gets an empty migration table: `backfilled` with `entries: []`. The scan does not report such
a branch (`LedgerScan.tablesOf` returns nothing for a revision without user tables), but without the table every table
created later would go unrecorded.

## 4. Effects

| What | Before | After |
| --- | --- | --- |
| Branch history | Head `H`, Draft `D` | New Head (the former `D` revision) = `H`'s tables + the migration table; new Draft = `D`'s tables + the same migration table version |
| Row data, views, shared schemas, files | — | Unchanged |
| Partial operations on the branch | Every table refused (`unledgeredTable`) | Refusals only for damage the scan reports |
| `getMigrations` of the Head | Empty | The backfilled entries |
| Native writers | Record nothing | Record `init`/`update`/`rename`/`remove` as on any branch |
| Scan | `unledgeredTable` (`noMigrationTable`) with roles `head`, `draft` and `history` | No such finding with role `head` or `draft`; the `history` ones remain (see below) |
| Other branches of the project | — | Unchanged; each branch is backfilled separately, and a branch created later from a pre-backfill revision needs its own run |

**What the scan reports afterwards.** The scan reads every history revision of the branch
(`ScanRevisionReader.readHistoryRevisionIds`, `scan-schema-ledger.handler.ts:70-77`). The former Head `H` and older
revisions keep no migration table, and history is never rewritten, so their `unledgeredTable` findings with
`reason: 'noMigrationTable'` and role `history` remain. An operator tells the branches apart by role: a branch still to
backfill has such findings with role `head`; a backfilled one has them only with role `history`.

Row diagnostics start for the backfilled tables. They are skipped for unledgered tables
(`migration/ledger-scan/branch-scan.ts:106-111`) and run by default for Head and Draft (`rowDiagnostics:
'headAndDraft'`). The trail of a backfilled table holds only its `init` (and `update`), so a row whose `schemaHash`
differs from the table's schema hash is reported as `rowSchemaHashMismatch` with reason `unknownHash`: for example a
row written under an earlier schema, or `''` from the low-level row API. This is a diagnostic only
(async-row-migration-v2 §5) and refuses no partial operation.

**Replicas.** No Head-synced replica of such a project can exist through migrations, because there was nothing to
export. After the backfill, a replica synced from scratch receives the entries and reproduces the Head schemas. A
replica whose tables were created by hand fails at the first `init` (`applyMigrations` refuses an `init` of an existing
table) and stops; making `applyMigrations` skip an `init` whose table exists with an equal schema is not part of this
version (§8, question 1). A replica stores the schemas the replay produces: for a table split by §3 step 3, that is the
schema after the `update`, equal to the Head schema because the table survives the split.

## 5. Storage

No database schema change. Per backfilled branch: one new table version and its rows, and one new revision (the new
Draft). The operation never updates a version that a revision other than the Draft links.

## 6. Compatibility

| Observable change | Who sees it | Release note |
| --- | --- | --- |
| New facade method `backfillSchemaLedger`. | Operators, hosts | Yes |
| A backfilled branch has one more commit, whose only change is the migration table. | History readers | Yes |
| A backfilled branch exports migrations and records native schema changes from then on. | `getMigrations`, replicas | Yes |
| The scan starts row diagnostics for backfilled tables and keeps `history` findings for revisions before the backfill. | Operators | Yes |

## 7. Acceptance scenarios

Each runs on a branch whose Head and Draft were stripped of the migration table (fixture `committedWithoutLedger`,
`src/__tests__/fixtures/branch-scenario.ts`), unless it says otherwise.

- BF-01 Tables `categories` and `products` (`products.category` references `categories`), rows edited in the Draft →
  `backfilled`; Head ledger = `init categories`, `init products` in that order; the new Head and the new Draft link the
  same migration table version, readonly with readonly rows; the head-schema check refuses nothing; the Draft's row
  changes are unchanged and a partial commit of one of them is `applied`.
- BF-02 Nested and array foreign keys order the referenced table first.
- BF-03 A self-reference needs no `update`; a cycle `a ↔ b` gives `init a` without the foreign key, `init b`,
  `update a` restoring it, and the replay reproduces both Head schemas.
- BF-04 `dryRun` → `planned`, and branch contents are byte-identical before and after. A later run on the unchanged
  branch → `backfilled` with entries equal in `changeType`, `tableId`, `hash` and order; the ids may differ.
- BF-05 A second run → `notNeeded`; a branch that always had a ledger → `notNeeded`.
- BF-06 The Draft creates, removes or renames a table, removes a table and creates another under its id, changes a
  schema, changes a schema and changes it back, or links a migration table → `refused` with `draftStructureChanged`
  and the tables; nothing is written. For a migration table the message advises a revert only.
- BF-07 A Head schema whose foreign key names a missing or a system table, a Head user table without a schema row, an
  invalid Head table id, or a Head schema the current rules reject (an invalid field name or formula, a `required` name
  without a property, an unknown `$ref`) → `refused` with `schemaNotReproducible` and the table, never an uncaught
  error, and the tables that reference it are not named; nothing is written.
- BF-08 An active async migration on the branch → `MigrationLockedException`, for a run and for a dry run; nothing is
  written.
- BF-09 A Draft writer racing the backfill, with the result of one order. Writer first: a row change is carried into
  the new Draft and not into the new Head, and the Head ledger is as in BF-01; a `createTable` makes the backfill
  `refused` (`draftStructureChanged`). Backfill first: the writer fails as it does after a native commit, because its
  revision is no longer the Draft. A writer whose transaction began before the backfill committed gets one of the two:
  one that copies a table version into the Draft fails as after a native commit; one that edits a Draft-owned version
  in place is ordered first and its change lands in the new Draft, because the backfill neither reads nor locks that
  version (a native commit locks it, so there that writer fails too).
- BF-10 A failure injected after the writes → nothing persists and no endpoint is notified.
- BF-11 A fresh Head-synced replica (`src/__tests__/fixtures/ledger-replicas.ts`) after the backfill reproduces the Head
  schemas and stored ledger, including a split cycle.
- BF-12 Native `updateTable` after the backfill records an `update` with an id after the backfilled ones. The scan of
  the branch reports no finding with role `head` or `draft`, and `unledgeredTable` (`noMigrationTable`) with role
  `history` for the former Head.
- BF-13 Other branches of the project are unchanged. A branch created from a pre-backfill revision → its own
  `backfilled`; a branch created from the new Head → `notNeeded`.
- BF-14 Wrong input types and a `null` `dryRun` / `comment` are handled as §2 says, before any transaction; without
  `comment` the commit's comment is `Backfill the schema ledger`.
- BF-15 The examples in §3 step 3 (three tables, two overlapping cycles, a cycle member with an ordinary reference, a
  table that references a cycle without being on it) give the listed entries, and the replay reproduces every Head
  schema.
- BF-16 In a cycle `a ↔ b` where `a`'s Head schema has `required` out of order or a non-empty `default`, `b` is split
  instead; when neither survives the split → `refused` with `schemaNotReproducible` naming both, and a table that only
  references the cycle is not named; after a native `updateTable` of `a` and a native commit, a run → `backfilled`.
- BF-17 A Head without user tables → `backfilled` with `entries: []`; a later native `createTable` records its `init`.
- BF-18 A Head row whose `schemaHash` differs from its table's schema hash: after the backfill the scan reports
  `rowSchemaHashMismatch` with `unknownHash` for the table (role `head`), and a partial commit of a change in that table
  is not refused.
- BF-19 Endpoints of the new Head and the new Draft are notified after `backfilled`; none after `planned`,
  `notNeeded` or `refused`.

## 8. Open questions

1. **Replicas with tables created by hand.** If such replicas of pre-v2.0.0 projects exist, `applyMigrations` could
   return `skipped` for an `init` whose table exists with an equal schema hash, instead of failing. Decided only if the
   user reports such replicas.

## 9. Delivery

| PR | Content | Done when |
| --- | --- | --- |
| 1 | This SPEC; async-row-migration-v2 and partial-changes-v1 point to it. | Reviewed and merged. |
| 2 | Planning and `dryRun` through the facade: input, lock check, Draft check, order and split, ids, replay verification. | BF-02, BF-03, the dry-run half of BF-04, BF-06, BF-07, the dry-run half of BF-08, BF-14 without the comment, BF-15, the refusals of BF-16. |
| 3 | The write, the stored-state verification and the notifications. | BF-01, the rest of BF-04, BF-05, BF-08, BF-09–BF-14, the rest of BF-16, BF-17–BF-19. |
| 4 | `docs/api.md` and `docs/migration.md`. | — |

## Changelog

### Version 1.2 (2026-11-10)

- §3 step 7 lists what the run reads back and checks, and how a failed check is reported (§9 PR 3).
- BF-09 says which order a writer gets whose transaction began before the backfill committed.

### Version 1.1 (2026-11-10)

Clarified while implementing the planning (§9 PR 2):

- A foreign key to a table that is not a Head user table refuses the table in the validate-first pass, so the tables
  that reference it are not named (§3 step 3, BF-07).
- An entry that fails `validateTableMigrationsSchema` refuses its table (§3 step 4).
- A Draft migration table is only reverted (§2).

### Version 1.0 (2026-11-10)

- New `backfillSchemaLedger` for branches without a migration table; replaces the backfill proposal of
  async-row-migration-v2 §7.
