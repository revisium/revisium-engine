# Schema Ledger Backfill Specification v1

## Overview

| Property | Value |
| --- | --- |
| Version | 1.0 |
| Status | Accepted |
| Date | 2026-11-10 |
| Parent ADR | [ADR-001](../adr/ADR-001-partial-commit-and-revert.md) |
| Requirements | [REQ-001](../requirements/REQ-001-partial-commit-and-revert.md): REQ-001.BR-002, REQ-001.BR-004, REQ-001.BR-005 |
| Depends on | [partial-changes-v1](partial-changes-v1.spec.md) §6.10, §6.13, §10; [async-row-migration-v2](async-row-migration-v2.spec.md) §5, §7, §13 |
| Code baseline | engine master `bfbcfb5`; paths are under `src/features/` unless they start with `src/` |

This specification adds `backfillSchemaLedger`, a maintenance operation that gives a branch without a migration ledger
one, so that partial commit and revert stop refusing its tables. It is the first fix of the data doctor; the checks are
the existing scan (`scanSchemaLedger`, async-row-migration-v2 §5) and the repair (`repairSchemaLedger`, §6) is the
second fix.

**The decision.** For a branch whose Head has no migration table, one operation writes a new commit whose only change
is a migration table holding an `init` for every Head user table (plus `update` entries that close foreign-key cycles).
The Draft keeps its content and links the same migration table. It replaces the proposal of async-row-migration-v2 §7
and decides its question 2 (§13): projects without a migration table get a ledger rather than an exemption.

## 1. Problem

The migration ledger (rows of the system table `revisium_migration_table`) appeared in core v2.0.0 (2025-08-02). Core
creates the table only for a new project (`create-project.handler.ts` in core); a project cloned with `fromRevisionId`
links the source revision's tables as they are. Native writers record nothing when the table is missing: they log and
return `false` (`draft/commands/handlers/migration/base-migration.handler.ts:37-57`). So a project created before
v2.0.0, and every clone of one, has no ledger at all, even for schema changes made after v2.0.0.

Partial operations need the ledger to tell recorded schema changes from damage (partial-changes §6.10, §10). Without
the table every user table is unledgered (`noLineage`), every partial operation on the branch is refused with
`unledgeredTable`, and only exactly `{ all: true }` works. The scan reports these branches as `unledgeredTable` with
`reason: 'noMigrationTable'`. Such projects exist in production.

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

`entries` is the planned ledger in id order: `{ id, changeType: 'init' | 'update', tableId }[]`.

| Refusal `code` | When | What the caller does |
| --- | --- | --- |
| `draftStructureChanged` | The Draft creates, removes or renames a user table, or a user table's Draft schema row differs from Head. Those changes were made without a ledger, so no pending entry could explain them. `tableIds`: the tables concerned. | Commit or revert the schema changes natively, then run again. |
| `schemaNotReproducible` | The planned ledger does not replay to every Head schema (§3 step 4), for example a foreign key to a table that does not exist. `tableIds`: the failing tables. | Fix the schema natively; a defect report if the schema is valid. |

Errors as the other writers: unknown project or branch; `MigrationLocked` (HTTP 423) while an async migration is active
on the branch; `BRANCH_WRITE_FENCED` when the exclusive fence cannot be taken.

## 3. Algorithm

Inside one Serializable transaction that holds the branch write fence exclusively and checks the migration lock
(partial-changes §8.4):

1. **Read** the Head and Draft revisions of the branch, their user tables and schema rows. If the Head links a
   migration table → `notNeeded`.
2. **Check the Draft.** Compare the user tables of Draft and Head by `createdId`: a table on one side only, a different
   table id, or a different schema row `data` → `refused` with `draftStructureChanged`. Row changes, views and shared
   schemas are allowed and kept.
3. **Plan the entries** for the Head user tables (`system: false`):
   - Order the tables so that a table comes after every table its schema references by `foreignKey`, at any depth
     (nested objects, array `items`); ties by table id in code-point order. A self-reference is no dependency.
   - When references form a cycle, break it at the edges that close it in that order: the `init` of the referring table
     carries the field's schema without `foreignKey`, and after all `init` entries one `update` per such table restores
     the fields with `replace` patches at their JSON Pointers.
   - `init` = `{ changeType: 'init', id, tableId, hash, schema }` with the Head schema row `data` as `schema` and
     `hash = objectHash(schema)`; `update` = `{ changeType: 'update', id, tableId, hash, patches }` with the hash of the
     schema after its patches. These are the shapes native writers produce (`share/schema/table-migrations-schema.ts`).
   - Ids: `nextNativeMigrationId` (`share/ledger/native-migration-id.ts`) from the transaction's clock, then each next id
     after the previous one, so the ids are distinct, increasing and after any time a replica has seen.
4. **Verify** by the ledger replay (`share/ledger-replay`): replaying the planned entries from an empty state must give
   every planned table an intact slot that reproduces its Head schema row (`checkTableSlot` → `reproduces`). Otherwise
   → `refused` with `schemaNotReproducible` and the failing tables.
5. If `dryRun` → `planned`; the transaction writes nothing.
6. **Write** with the partial-commit writer (partial-changes §6.13):
   - a new table version `revisium_migration_table` (`system: true`, `readonly: true`, new `createdId` and `versionId`)
     with one row per entry: `id = data.id = migration id`, `publishedAt = id`, `hash = objectHash(data)`, `schemaHash`
     = the migrations table schema hash, as native migration rows (`base-migration.handler.ts:119-136`);
   - the target (new Head) links the Head table versions and the new migration table version; the Draft revision
     becomes that Head, and the new Draft links the former Draft's table versions and the same migration table version,
     with the former Draft's `hasChanges`;
   - the commit carries `comment`; the branch Head moves as on any commit.
7. **Verify the stored state**, as the repair does (async-row-migration-v2 §6.4): the stored Head ledger replays to the
   Head schemas, ids strictly increase, and the head-schema check of partial-changes §6.10 refuses no Head user table. A
   failure rolls back and raises an error (a defect, not an outcome).

After the commit, endpoints of the new Head and Draft are notified, as after a partial commit. The usual attempt loop
retries serialization failures; a retry re-plans from step 1, so a run that already succeeded returns `notNeeded`.

## 4. Effects

| What | Before | After |
| --- | --- | --- |
| Branch history | Head `H`, Draft `D` | New Head (former `D` revision) = `H` + the migration table; new Draft = `D`'s content + the same migration table |
| Row data, views, shared schemas, files | — | Unchanged |
| Partial operations on the branch | Every table refused (`unledgeredTable`) | Refusals only for damage the scan reports |
| `getMigrations` of the Head | Empty | The backfilled entries |
| Native writers | Record nothing | Record `init`/`update`/`rename`/`remove` as on any branch |
| Other branches of the project | — | Unchanged; each branch is backfilled separately, and a branch created later from a pre-backfill revision needs its own run |

**Replicas.** No Head-synced replica of such a project can exist through migrations, because there was nothing to
export. After the backfill, a replica synced from scratch receives the entries and reproduces the Head schemas. A
replica whose tables were created by hand fails at the first `init` (`applyMigrations` refuses an `init` of an existing
table) and stops; making `applyMigrations` skip an `init` whose table exists with an equal schema is not part of this
version (§8, question 1).

## 5. Storage

No database schema change. One new table version and its rows per backfilled branch; one new revision (the commit). The
operation never updates a version a non-Draft revision links.

## 6. Compatibility

| Observable change | Who sees it | Release note |
| --- | --- | --- |
| New facade method `backfillSchemaLedger`. | Operators, hosts | Yes |
| A backfilled branch has one more commit, whose only change is the migration table. | History readers | Yes |
| A backfilled branch exports migrations and records native schema changes from then on. | `getMigrations`, replicas | Yes |

## 7. Acceptance scenarios

Each runs on a branch whose Head and Draft were stripped of the migration table (fixture `committedWithoutLedger`,
`src/__tests__/fixtures/branch-scenario.ts`), unless it says otherwise.

- BF-01 Tables `categories` and `products` (`products.category` references `categories`), rows edited in the Draft →
  `backfilled`; Head ledger = `init categories`, `init products` in that order; the head-schema check refuses nothing;
  the Draft's row changes are unchanged and a partial commit of one of them is `applied`.
- BF-02 Nested and array foreign keys order the referenced table first.
- BF-03 A self-reference needs no `update`; a cycle `a ↔ b` gives `init a` without the foreign key, `init b`,
  `update a` restoring it, and the replay reproduces both Head schemas.
- BF-04 `dryRun` → `planned` with the same entries a run writes; branch contents are byte-identical before and after.
- BF-05 A second run → `notNeeded`; a branch that always had a ledger → `notNeeded`.
- BF-06 The Draft creates, removes or renames a table, or changes a schema → `refused` with `draftStructureChanged`
  and the tables; nothing is written.
- BF-07 A Head schema whose foreign key names a missing table → `refused` with `schemaNotReproducible`; nothing written.
- BF-08 An active async migration on the branch → `MigrationLocked`; nothing written.
- BF-09 A concurrent Draft writer and the backfill: one waits for the exclusive fence, and the result equals running
  them in either order.
- BF-10 A failure injected after the writes → nothing persists.
- BF-11 A fresh Head-synced replica (`src/__tests__/fixtures/ledger-replicas.ts`) after the backfill reproduces the Head
  schemas and stored ledger.
- BF-12 Native `updateTable` after the backfill records an `update` with an id after the backfilled ones, and the scan
  reports no finding for the branch.
- BF-13 Other branches of the project are unchanged.
- BF-14 Wrong input types and a `null` `dryRun` / `comment` are handled as §2 says, before any transaction.

## 8. Open questions

1. **Replicas with tables created by hand.** If such replicas of pre-v2.0.0 projects exist, `applyMigrations` could
   return `skipped` for an `init` whose table exists with an equal schema hash, instead of failing. Decided only if the
   user reports such replicas.

## 9. Delivery

| PR | Content | Done when |
| --- | --- | --- |
| 1 | This SPEC; async-row-migration-v2 §7 and §13 and partial-changes-v1 §6.10 point to it. | Reviewed and merged. |
| 2 | Planning and `dryRun` through the facade: Draft check, ordering, cycle breaking, ids, replay verification. | BF-02–BF-04, BF-06, BF-07, BF-14. |
| 3 | The write and the stored-state verification. | BF-01, BF-05, BF-08–BF-13. |
| 4 | `docs/api.md` and `docs/migration.md`. | — |

## Changelog

### Version 1.0 (2026-11-10)

- New `backfillSchemaLedger` for branches without a migration table; replaces the backfill proposal of
  async-row-migration-v2 §7.
