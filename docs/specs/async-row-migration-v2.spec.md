# Async Row Migration Specification v2

## Overview

| Property | Value |
| --- | --- |
| Version | 2 |
| Status | Accepted |
| Date | 2026-10-31 |
| Parent ADR | [ADR-001](../adr/ADR-001-partial-commit-and-revert.md), delivery stage 0 |
| Requirements | [REQ-001](../requirements/REQ-001-partial-commit-and-revert.md): REQ-001.BR-004, REQ-001.BR-005 |
| Previous version | [async-row-migration-v1]: shadow table, batches, worker modes, statuses and branch lock are kept |
| Depends on | [partial-changes-v1](partial-changes-v1.spec.md) §6.9–§6.10, §8.3–§8.4, §12 |
| Code baseline | engine master `5bcdd8f`; paths are under `src/features/` unless they start with `src/` or `prisma/` |

This specification fixes async table migrations (the "Async migration fix, detection and repair" item of partial-changes
§12) and adds two maintenance operations: the detection scan `scanSchemaLedger` and the forward-only repair
`repairSchemaLedger`. It changes no database schema (ADR-001 decision 8).

**The decision.** An async migration becomes a recorded native `updateTable` run in batches by one guarded state machine
(compare-and-set on status and a per-claim token, irreversible terminal states, bounded recovery of every phase). The
swap writes what the synchronous path writes and deletes the record in one Serializable transaction. `applyMigrations`
drives the migration it started and observes it on a separate timer, holding nothing while it waits; the source id
travels in a versioned envelope in the existing `patches` column. The repair records the ledger only and leaves tables
with invalid Draft rows refused; their remediation, like the ledger backfill, waits for the scan results.

**Landed since the parent SPEC:** #85 copy-on-write by `INSERT … SELECT`; #86 Serializable views writes; #87 imported-id
check in the change transaction; #88 no 100-referrer limits; #89 lock check inside every Draft writer's transaction;
#90 cleanup spares active shadows; #91 commit locks Draft-owned rows only; #92 fence part 1 (Draft writers and the async
start take the fence shared). Pending: fence part 2; the ledger replay (#93).

## 1. Terms

| Term | Meaning |
| --- | --- |
| Async migration | `updateTable` of a table with at least `threshold` rows (default 1,000): a `TableMigration` record, a shadow table, copy batches and a swap. |
| Record | The `TableMigration` row of one async migration. **Active**: `PENDING`, `COPYING` or `SWAPPING`; an active record locks every Draft writer of its revision (`MigrationLockedException`, code `MIGRATION_LOCKED`, HTTP 423). **Terminal**: `FAILED`, `CANCELLED`, or deleted (completed or aborted). |
| Payload | The JSON in `TableMigration.patches`: a legacy patch array, or the envelope `{ "version": 2, "patches": [...], "ledgerMigrationId"?: "..." }` (§3.1). |
| Claim, token, lease | A worker owns a record after writing a fresh token (worker id plus a random suffix) into `lockedBy`; the lease lasts while `heartbeatAt` is newer than `lockTimeoutMs` (default 60 s). |
| Progress deadline | `greatest(lastProgressAt, lockedAt)` (or `createdAt` when never claimed) older than `stallTimeoutMs` (default 10 min), whatever the heartbeat. |
| Source, shadow table | The table version the Draft links at start (`sourceTableVersionId`); the detached version the batches fill (`shadowTableVersionId`). |
| Native runner | The engine's Serializable runner: at most 20 attempts in total (`TRANSACTION_MAX_RETRIES`) on serialization failures, each under `TRANSACTION_TIMEOUT` (default 15 s) (`src/infrastructure/database/transaction-prisma.service.ts:214-226, 245`). |
| Branch write fence | A per-branch advisory lock: Draft writers take it shared inside their transaction and wait at most half of `TRANSACTION_TIMEOUT`, then fail with `BranchWriteFencedException` (`src/infrastructure/database/branch-write-fence.service.ts:6-9, 32-42`; `draft/draft-write-admission.service.ts:51-54`). |
| Ledger | The rows of `revisium_migration_table` linked by a revision, in id order; published entries are linked by the Head, pending entries only by the Draft. Native rule: `nextNativeMigrationId` (`draft/commands/handlers/migration/native-migration-id.ts:12-26`). |
| Imported-id check | The id is not in the Draft ledger and no ledger row has `publishedAt` at or after it (`draft/commands/handlers/migration/check-imported-migration-id.handler.ts:30-43, 61-75`). |
| Replay; predicates (a), (b) | §5.1; partial-changes §6.10: (b) the replayed schema deep-equals the schema row (refusal predicate); (a) row `schemaHash` equals the schema row `hash` (diagnostic only). |
| Damaged table | Fails (b) in the Head; shape (i) unpublished or (ii) published (partial-changes §6.10). |

## 2. Requirement coverage

| Item | Covered by |
| --- | --- |
| Copy-on-write, recorded `update` row and history; swap re-checks (partial-changes §12) | §3.5, §3.6 |
| One per revision in the transaction; synchronous validation; file references | §3.3, §3.4 |
| Orphan cleanup (landed, #90); `applyMigrations` above the threshold (must) | §3.7; §4 |
| Detection scan; forward-only repair; ledger backfill and row remediation (decided with the scan results) | §5, §6, §7 |
| REQ-001.BR-004 (a Head-synced replica accepts every commit) | Recorded async updates (§3.5), imported updates with source ids (§4), repaired tables (§6). |
| REQ-001.BR-005 (whole-Draft operations unchanged) | Native commit and revert are unchanged; every other observable change is in §9. |

## 3. The fixed async migration

### 3.1 Record payload

**Envelope.** The start transaction writes `{ "version": 2, "patches": [...], "ledgerMigrationId"?: string }` into
`TableMigration.patches`; `ledgerMigrationId` is set only when `applyMigrations` starts the migration (§4).

**One decoder.** The `migration` feature owns the only decoder of the column and every reader uses it (today
`migration/services/migration.service.ts:275, 447, 494` read the array directly; the writer is `:147`). It returns
`{ version: 1, patches }` for a JSON array, `{ version: 2, patches, ledgerMigrationId }` for the envelope, and a
permanent failure `PAYLOAD_UNSUPPORTED` for anything else. Hosts that read the column directly must expect the envelope.

**Upgrade rule.** Old workers misread the envelope, so every engine process running the old worker code (inline,
polling, or a host runner in `disabled` mode) is stopped before any new process writes a record; a rolling deploy across
this version is not supported. Every new process disposes of legacy records when it starts (§3.2).

### 3.2 State machine

Today no transition is guarded by ownership: initialization sets `COPYING` unconditionally
(`migration.service.ts:220-233`), a retry resets `PENDING` (`migration/services/migration-progress.service.ts:84-96`),
heartbeat and release update by id only (`migration/services/migration-worker.service.ts:263-292`), progress is written
by id (`migration.service.ts:316-333`), and recovery always restarts from initialization (`:171-175`).

**Transitions.** Each row is one statement or one transaction; a guard that matches nothing writes nothing and the
caller receives `stopped`. No transition starts from a terminal state, so terminal states are irreversible (a new start
of the same table deletes the old terminal record, as today, `migration.service.ts:119-159`). Every effect sets the
listed columns only; `getMigrationStatus` exposes `status`, `phase`, `startedAt` and `completedAt`.

| Id | Transition | Actor | Guard → effect |
| --- | --- | --- | --- |
| T-start | none → `PENDING` | start (§3.3) | Serializable, no active record in the revision → `phase = INIT`, `lockedBy` empty, `lastProgressAt` empty. |
| T-claim | owner change | worker, `processMigration`, importer (§4) | Active, and `lockedBy` empty or lease expired → new token, `lockedAt = heartbeatAt = now`; for a `SWAPPING` record also `retryCount + 1`, and at `maxRetries` T-fail (`SWAP_STALLED`) instead. |
| T-takeover | owner change of `SWAPPING` | sweep, observer | `SWAPPING`, the observed token **and** `lockedAt` (the owner's epoch), and `greatest(lastProgressAt, lockedAt)` older than the swap bound, whatever the heartbeat → new token, `lockedAt = heartbeatAt = now`, `retryCount + 1`; at `maxRetries` T-fail (`SWAP_STALLED`) instead. |
| T-beat | heartbeat | owner | Token → `heartbeatAt = now`; no match → the owner stops. |
| T-release | lease release | owner | Token → `lockedBy`, `lockedAt` empty (shutdown, or after T-retry). |
| T-init | `PENDING` → `COPYING` | owner | One transaction: `PENDING` and token → `status = phase = COPYING`, `startedAt` (first time only), `lastProgressAt = now`; creates the shadow table when none exists (copying `createdAt` and `system` of the source) and records it. |
| T-batch | `COPYING` → `COPYING` | owner | First statement of the batch transaction (§3.4): `COPYING`, token, `copiedRows` and `lastCopiedRowId` equal to the batch's checkpoint → new checkpoint, `currentBatch + 1`, `lastProgressAt = now`. |
| T-swap-begin | `COPYING` → `SWAPPING` | owner | `COPYING`, token, `copiedRows = totalRows` → `status = phase = SWAPPING`, `lastProgressAt = now`. |
| T-swap | `SWAPPING` → deleted | owner | The swap transaction (§3.5). |
| T-fail | active → `FAILED` | owner | Status as read and token → `errorMessage = 'CODE: detail'`, `completedAt = now`, lease cleared; `phase` kept. |
| T-retry | active → same status | owner | Status as read and token → `retryCount + 1`, then T-release; at `maxRetries` (default 3) T-fail instead. |
| T-cancel | `PENDING`/`COPYING` → deleted | `abortMigration`, native revert (§3.6) | The record deletion is guarded by status; `SWAPPING` is rejected. |
| T-deadline | `PENDING`/`COPYING` → `CANCELLED` | sweep, driver, observer | Progress deadline passed → `errorMessage = 'STALLED: …'`, `completedAt = now`, lease cleared. |

**Runner.** After T-claim or T-takeover the owner runs one step at a time; each step returns `continue`, `completed`,
`failed`, `cancelled` or `stopped`, and the runner proceeds only on `continue`, so nothing falls through to a later
phase. `PENDING` resumes at T-init, `COPYING` at the next batch from the committed checkpoint, `SWAPPING` directly at
T-swap. Transient errors (timeouts, lost connections, `BranchWriteFencedException`, serialization failures that outlast
the runner) apply T-retry; permanent ones apply T-fail (§3.8). `processMigration(migrationId)` claims before it runs and
returns the step result.

**Bounded `SWAPPING`.** A swap attempt lasts at most `TRANSACTION_TIMEOUT` and the native runner makes at most
`TRANSACTION_MAX_RETRIES` attempts; the **swap bound** is the larger of `stallTimeoutMs` and that product. Each owner
gets the whole bound from its own ownership epoch: the deadline is measured from `greatest(lastProgressAt, lockedAt)`,
and T-claim and T-takeover set `lockedAt = now`, so a fresh replacement is never already past it. T-takeover is guarded
by the observed token and `lockedAt`, so concurrent observers replace one owner at most once. Takeovers and claims of
a `SWAPPING` record (a replacement after lease expiry, for example after the owner crashed) count in `retryCount`, so
both share one recovery budget; when it reaches `maxRetries` the taker or claimant applies T-fail with `SWAP_STALLED`,
which is terminal and releases the lock. A replaced owner's swap either committed first (T-takeover matches nothing)
or conflicts, retries, reads another token or a non-`SWAPPING` record and stops. Abort and revert keep rejecting
`SWAPPING` (§3.6).

**Recovery scheduling.** `inline` mode keeps the start-time trigger and adds a recurring sweep every `pollIntervalMs`
applying T-claim, T-takeover and T-deadline (today recovery runs once at startup,
`migration-worker.service.ts:64-73, 103-126`); `polling` runs the same sweep on its own timer (today the watchdog is
skipped while processing and needs a stale heartbeat and a non-null `lastProgressAt`, `:187-210, 358-383`); `disabled`
has no timers: `processMigration` callers and importers drive, importers observe (§4).

**Legacy records** (a JSON-array payload, written by the old code) are disposed of by every process at startup, before
its worker or sweep runs, each by one guarded statement, because they carry no source migration id and an imported one
would be recorded under an id its source does not know. Every shape ends terminal:

| Legacy record | Disposition |
| --- | --- |
| `FAILED`, `CANCELLED` | Kept; decoded as version 1. |
| `PENDING`, `COPYING` | `CANCELLED` (`LEGACY_JOB`): the change was never applied; rerun `updateTable` or the import. |
| `SWAPPING`, revision missing | Deleted. |
| `SWAPPING`, the Draft links the shadow table | Deleted: the old swap committed; its damage is left to the scan and repair. |
| `SWAPPING`, any other state (source linked, neither linked, revision no longer the Draft) | `CANCELLED` (`LEGACY_JOB`). |

### 3.3 Start: admission and schema validation

**Today.** `ApiUpdateTable` checks the lock and routes outside any transaction
(`draft/commands/handlers/api-update-table.handler.ts:35, 37`). The start transaction
(`migration/commands/handlers/start-async-migration.handler.ts:35-104`) takes the fence shared (`:37`, #92) without a
lock check, validates against the meta-schema only (`:73-81`) and inserts the record; the unique key
`(revisionId, tableId)` (`prisma/schema.prisma:143`) excludes only a second record of the same table. A trigger error
after the commit (`:106`) fails the call although the record exists.

**New.** Input `revisionId`, `tableId`, `patches`, and `ledgerMigrationId` from `applyMigrations` only. One Serializable
transaction through the native runner, admitted as a Draft writer (§3.9):

1. The revision is the Draft, else `BadRequestException('Revision is not a draft')`.
2. **One per revision:** any active record of the revision → `MigrationLockedException`, from the in-transaction lock
   check of Draft writer admission (`draft-write-admission.service.ts:51-54` →
   `migration/services/migration-lock.service.ts:86-111`). Two concurrent starts read the range the other inserts into,
   so SSI aborts one and its retry sees the winner. A partial unique index is not used: it would be a schema change.
3. **Schema validation of the synchronous path**, in its order and with its exceptions: at least one patch, the JSON
   Patch schema and every `add`/`replace` value, not a system table
   (`draft/commands/handlers/update-table.handler.ts:57-63, 80-82, 165-186`); the target schema against the meta-schema,
   existing foreign-key targets other than the table itself, and formulas (`:124-127` →
   `transactional/validate-schema.handler.ts:23-40, 54-75`); field names and the history-patch schema
   (`transactional/update-schema.handler.ts:43-57, 96-110`); a dry run of the views migration
   (`update-table.handler.ts:232-291`).
4. With `ledgerMigrationId`: the Draft must link a migration table, else `LEDGER_UNAVAILABLE` (an imported update cannot
   be recorded durably); then the imported-id check.
5. Insert the record (T-start) with the envelope.

After the commit, trigger errors are logged and the call returns the committed `migrationId`; the sweep or an importer
runs it. **Caller observes:** the async result as today, with the table version linked when the response is built (the
shadow if a small migration already finished; `api-update-table.handler.ts:95-107`); every schema error of the
synchronous path; `MIGRATION_LOCKED` for a concurrent second start; `BranchWriteFencedException` behind an exclusive
holder (§3.9).

### 3.4 Copy batches

**Today.** A batch is read outside a transaction (`migration/services/migration-batch.service.ts:28-45`), patched with
formulas evaluated (`:47-82`), and inserted one statement per row with no blob links and no validation (`:84-112`)
inside a transaction without options (`migration.service.ts:316-333`: ReadCommitted, Prisma's 5 s default).

**New.** Read and migrate the batch as today; validate every migrated row against the target schema and its foreign-key
references against the revision as the synchronous path does (`transactional/validate-data.handler.ts:39-57`); then one
ReadCommitted transaction with `TRANSACTION_TIMEOUT`: **first** T-batch (it locks the record row), then the shadow rows,
then their file references against the target schema (file-usage owner, per row until the set-based item lands). If
T-batch matches nothing the transaction rolls back and the worker stops: a stale worker, a cancelled record or a
completed swap can never add rows, in particular not to a shadow table that a swap and a commit have made the Draft's or
the Head's. An invalid row is permanent (`ROW_INVALID: <synchronous message>`). File references normally point at blobs
the source rows already link, so registration adds links and leaves project bytes unchanged.

### 3.5 Swap

**Today.** `SWAPPING` is set outside the transaction and the record is read before it (`migration.service.ts:374-382`);
the Serializable transaction (`:390-418`) relinks and rewrites the schema row (`:445-457`) and the views row
(`:491-508`) **in place by `versionId`**, records no migration and no history, re-checks nothing; the record is deleted
in a later statement (`:511-520`), so a crash in between makes recovery rewrite the schema again.

**New.** After T-swap-begin, one Serializable transaction through the native runner, admitted as in §3.9:

1. Read the record: missing, not `SWAPPING`, or another token → `stopped`, nothing written.
2. Re-checks. A failure commits only T-fail with its code and leaves everything else as observed: the revision is the
   Draft (`REVISION_NOT_DRAFT`); the Draft links the source and not the shadow (`SOURCE_TABLE_REPLACED`); the Draft
   schema row has `previousSchemaHash` and the decoded patches turn `previousSchema` into `targetSchemaHash`
   (`SCHEMA_CHANGED`); the shadow holds `totalRows` rows (`ROW_COUNT_MISMATCH`); with `ledgerMigrationId`, a linked
   migration table (`LEDGER_UNAVAILABLE`) and the imported-id check (`LEDGER_ID_TAKEN`).
3. Unlink the source, link the shadow.
4. Write the schema through the synchronous path's schema writer (`transactional/update-schema.handler.ts:38-65`):
   copy-on-write of the schema table and row when shared, the history entry `{ patches, hash, date }` with the original
   patches, and the migration row `{ changeType: 'update', tableId, id, hash, patches }` with `id = ledgerMigrationId`,
   else the native rule (`draft/commands/handlers/migration/base-migration.handler.ts:64-87`). The migration writer
   returns `false` without writing when the Draft has no migration table (`base-migration.handler.ts:34-58`), and the
   schema writer ignores that result today (`update-schema.handler.ts:59-64`). The swap reads it: `false` is a failure
   (`LEDGER_NOT_RECORDED`, the transaction rolls back and T-fail follows) unless the update is interactive and the Draft
   has no migration table, where it completes without a ledger row exactly as the synchronous path does.
5. Migrate the views row through the synchronous views writer with copy-on-write (`update-table.handler.ts:232-291`).
6. Set `hasChanges`; delete the record, requiring exactly one deleted row with the token.

After the commit the worker notifies endpoints for the Draft (as `api-update-table.handler.ts:70`); a notification error
is logged and does not repeat or fail the swap. The swap is idempotent: change and deletion commit together, and a lost
acknowledgement leaves no record to repeat. **Caller observes:** the Draft ledger gains the `update`, the Draft history
its entry; the Head and earlier revisions keep their rows; `getMigrationStatus` returns `null` after success, as today;
a failed re-check leaves `FAILED` with its code.

### 3.6 Cancellation

**Today.** `abortMigration` runs statement by statement
(`migration/commands/handlers/abort-migration.handler.ts:14-71`): it reads the status, then deletes the shadow rows, the
shadow table and the record without guards, so a swap that commits between the read and the deletes loses the Draft's
rows to the abort. Native revert cancels `PENDING` and `COPYING` inside its transaction and rejects `SWAPPING`
(`migration-lock.service.ts:17-84`).

**New, decision: reject during `SWAPPING`, never wait** (the swap is bounded and stalled owners are taken over, §3.2).
Abort deletes the record with a status guard (`PENDING` or `COPYING`; `SWAPPING` gets today's message) and deletes the
shadow rows and table **only after its own guarded deletion removed the record**, with a no-revision-links-it predicate
as defence in depth. Revert keeps its behaviour. Outcomes: before T-swap-begin the cancel wins and the worker stops at
its next guard; overlapping it, the record row lock orders them; `SWAPPING` visible → rejected; swap completed → abort
removes nothing and returns as for no migration, revert reverts the result.

### 3.7 Orphan cleanup (landed, #90)

`cleanOrphanedData` deletes unlinked table versions except shadows of active records, in one statement
(`src/infrastructure/database/cleanup.service.ts:43-55`). T-init creates and records the shadow in one transaction, so
the statement never sees an unrecorded shadow. Shadows of terminal records stay deletable.

### 3.8 Failures

| Failure | Result |
| --- | --- |
| Validation, lock, fence wait, Draft, ledger availability or imported-id check at start | Exception to the caller; no record. |
| Invalid row; failed re-check; `LEDGER_NOT_RECORDED`; `PAYLOAD_UNSUPPORTED`; `SWAP_STALLED` after `maxRetries` takeovers or claims of `SWAPPING` | Permanent: T-fail with the code. |
| Timeout, lost connection, `BranchWriteFencedException`, exhausted serialization retries | Transient: T-retry; the next claim resumes the same phase. |
| A guard matches nothing | `stopped`; no write. |

`FAILED` releases the lock and leaves the Draft as the swap found it; a new `updateTable` replaces the record. Codes are
the leading token of `errorMessage`; there is no error column.

### 3.9 Write fence per phase

Fence part 1 (#92) makes each Draft writer take the fence shared inside its Serializable transaction, before its
migration-lock check (`draft-write-admission.service.ts:14-23, 51-54`). Part 2 makes commit and revert escalate to
exclusive after serialization failures, holding the exclusive lock in a **separate holder transaction** (partial-changes
§8.4).

| Phase | Fence |
| --- | --- |
| Start (§3.3), swap (§3.5), repair write (§6.4) | Shared, once per transaction; nested native writers run inside it. The swap takes the fence without the migration-lock check, because its own record is the active one. |
| Claim, takeover, heartbeat, init, batch, swap-begin, fail, retry, release, deadline, abort | None: they write only the record and the detached shadow. |
| `applyMigrations` between steps and while waiting | None: it never holds a transaction or the fence across a wait (§4). |
| Scan, repair planning | None (read-only). |

**Exclusive holder admission.** An operation protected by its own exclusive holder must not enter shared admission for
that branch, or it waits for its own holder until `BranchWriteFencedException`. The holder runs it with an explicit
admission mode in the transaction context (the per-async-context store of the transaction service, not a process-wide
flag): `exclusiveHeld` with the branch id. Shared admission for that branch is skipped; the migration-lock check still
runs in the operation's transaction, so an escalated commit still returns `MIGRATION_LOCKED`; the holder is released on
every exit (success, error, timeout). Start and swap never run in that mode: they take the fence shared and wait behind
a holder for at most half of `TRANSACTION_TIMEOUT`, then fail with `BranchWriteFencedException` (an error to the start's
caller, a transient failure of the swap). An exclusive holder never waits for a migration, so no cycle exists.

## 4. `applyMigrations` above the threshold

**Today.** An `update` calls `apiUpdateTable` (`draft/commands/handlers/migration/apply-migrations.handler.ts:133-138`)
under the migration context (`:42-44`); above the threshold `applyMigrations` reports `applied` (`:90-93`) once the
record exists, the source id is never written, and the next migration hits the lock (PoC: `applied` after 1.5 s while
`COPYING`). The imported-id check runs before (`:99-106`) and, for synchronous changes, inside their transaction too
(`update-table.handler.ts:70-71`, #87).

| Option | For | Against |
| --- | --- | --- |
| A. Apply the `update` synchronously whatever the size | No new state. | Whole table in memory and one Serializable transaction over every row: the PoC 100k-row replica failed with P2028 after ~145 s (memory backlog item, partial-changes §12). Replicas stop at the first large update. |
| **B. Start the async migration with the source id and wait** | Bounded memory; short transactions; one path for people and replicas; the swap writes the ledger row with the source id atomically, so the replica ledger stays a prefix (partial-changes §10.3). | The call lasts as long as the migration. |

**Decision: B**, with the source id durable in the payload envelope (§3.1). A nullable column would work too but is a
schema change against ADR-001 decision 8; the in-process migration context alone is lost on restart.

**Contract** for an `update` with id `M` whose Draft table has at least `threshold` rows:

1. The imported-id pre-check as today: `M` recorded → `skipped`; out of order → `failed`.
2. An active record of the revision whose payload carries `M` → join it (step 4). Any other active record → `failed`
   with the `MIGRATION_LOCKED` message.
3. Start (§3.3) with `ledgerMigrationId = M`; a start error (including `LEDGER_UNAVAILABLE`) → `failed` with its
   message, before any mutation.
4. **Drive and observe, separately.** The **observer** runs on its own timer every `pollIntervalMs`; it never awaits a
   driver and holds no transaction or fence between ticks. Each tick reads the record and, in order: applies T-deadline
   when due; if no local driver of this record runs in this process (one per record, tracked in process) and the lease
   is empty or expired, applies T-claim and starts a local driver; if the record is `SWAPPING` past its owner's bound,
   applies T-takeover and starts a local driver. A driver runs the steps until a non-`continue` result and ends; the
   next tick decides again. This restarts a joined import whose previous owner died (its lease expires), a local driver
   that released the lease after a transient failure (T-retry, bounded by `maxRetries`), and `disabled` mode, where the
   importer's observer is the only source of drivers. The result comes from the observer only, so a driver stalled
   outside any transaction cannot stop the wait; when it resumes, its guards fail and it stops.
5. When no active record carries `M`: ledger row `M` in the Draft → `applied`; a `FAILED` record → `failed` with its
   `errorMessage`; otherwise → `failed` with `CANCELLED`. The batch stops at the first `failed`, as today.

No transaction or fence is held between steps or while observing. The wait ends because a live owner completes, a
stalled `PENDING`/`COPYING` record is cancelled and a stalled `SWAPPING` owner is taken over; a host that abandons the
call leaves the migration recoverable, and a repeated call joins it (step 2). Below the threshold nothing changes.

## 5. Detection scan `scanSchemaLedger`

### 5.1 Ledger replay

The replay (#93) is one function shared with partial-changes §6.9–§6.10, the scan and the repair. It works in two passes
over the ledger in id order:

- **Identity pass**, without schema validation: `init` opens a slot under its id, `rename` moves a slot to the new id,
  `remove` closes it; an id freed by `rename` or `remove` can be reused by a later `init`. A `rename`, `update` or
  `remove` of an id without an open slot is unattributable and breaks the lineage of that id. The result: for every id
  open at the end, its slot and lineage.
- **Schema pass** over the same slots: `init` creates the schema; `update` applies the patches with the synchronous
  path's patch application; `rename` moves the schema and rewrites referrer foreign keys as native rename does
  (`transactional/rename-schema.handler.ts:48-77`); `remove` is refused while referenced. A foreign key must name an
  open slot, except the table's own id, which native create allows (`validate-schema.handler.ts:54-75`). A failing step
  is atomic and **taints** its slot (a failed rename still moves the slot, tainted); every later step that reads a
  tainted slot taints its own. Results per slot: a schema, or the first failing migration, plus the trail of schema
  hashes after each step with its cause (an own step or a referrer rewrite).

A current table is **ledgered** when the identity pass ends with an open slot under its id and an intact lineage;
otherwise it is **unledgered**. A ledgered table whose slot is tainted is **unreplayable**. Schemas compare by deep
equality, key order ignored.

### 5.2 Operation

A facade method (`src/engine-api.service.ts`, beside `validateProjectFileBytes`) implemented by the `migration` feature.
The engine has no CLI (`src/main.ts` only starts the application): the host exposes it to administrators, which the
release gate needs. Read-only; no permission layer in the engine.

| Input | Type | Meaning |
| --- | --- | --- |
| `projectId` | string, optional | One project; omitted → every project with a branch. |
| `branchName` | string, optional | One branch; requires `projectId`. |
| `cursor`, `limit` | string; integer 1–1,000, default 50 | Paging by (`projectId`, `branchName`). |
| `rowDiagnostics` | `'none' \| 'headAndDraft' \| 'all'`, default `'headAndDraft'` | Where predicate (a) runs. |

Output `{ findings, nextCursor, stats }`; **Finding**
`{ code, projectId, branchName, tableId, role: 'head' | 'draft' | 'history', revisionIds, detail }`, one per distinct
evaluation with every revision of the branch that shares it.

| Code (precedence for one table and role) | Meaning and `detail` |
| --- | --- |
| `unledgeredTable` | Unledgered by the identity pass; `reason`: `noMigrationTable`, `noLineage` or `brokenLineage` (with the unattributable migration). |
| `unreplayableLedger` | Ledgered with a tainted slot; the first failing migration and error. Not repairable forward; replicas need a re-sync. |
| `damagedTable` (Head) | Fails (b). `shape` from the Head table version's row hashes, read even with `rowDiagnostics: 'none'`: `unpublished` when some rows carry the replayed schema's hash and none the schema row's, `published` when all rows carry the schema row's hash, else `unknown` (empty, mixed, other hashes). `repair`: the repair planner's outcome (§6.2), or `deferred` while an async migration is active on the branch. |
| `draftOnlyDamage` (Draft) | Draft fails (b) under a passing Head: revert the table's structure; no repair. |
| `damagedHistory` | An earlier revision fails (b); not repaired (rewriting history needs its own ADR). |
| `rowSchemaHashMismatch` | Predicate (a) fails; diagnostic only. Per distinct row hash, first match wins: `unmigratedByAsync` (the table fails (b) and the hash is the replayed schema's); `renamedReference` (the hash is in the slot's trail and only referrer rewrites follow it: a known false positive); `unmigratedRows` (an own step follows it); `unknownHash` (not in the trail, for example `''` from the low-level row API: a known false-positive source). |

### 5.3 Algorithm and cost

1. Per branch of the page, read the Head and Draft ids, the Draft's links and its system rows in one `READ ONLY`
   RepeatableRead transaction; committed revisions are read without a long transaction, which is valid once no old
   worker runs (§12, production scan after the fix is deployed).
2. Deduplicate (partial-changes §12): replay once per distinct migration-table version; read once per distinct
   schema-table version; evaluate (b) once per distinct pair of migration-table and schema-row versions; evaluate (a)
   once per distinct pair of table version and schema-row hash. Caches live for the call.
3. Classify by role and precedence (§5.2); run the repair planner for Head `damagedTable` findings.
4. Predicate (a), and the shape of damaged Head tables: one `GROUP BY schemaHash` statement per selected table version.

Predicate (b) grows with the number of system-table versions, not with data. Predicate (a) reads every row link of each
selected table version (the Head and Draft tables with `'headAndDraft'`, up to all of `_RowToTable` with `'all'`); it
dominates and runs off-peak. The repair planner adds row validation of damaged tables (§6.3). Errors: unknown project or
branch → not found; `branchName` without `projectId`, a malformed `cursor` or `limit` → validation error. No retries; a
failed call is repeated from its `cursor`. Causes other than async migrations also fail (b), for example referrers left
by the 100-referrer rename limit before #88; they are reported and repaired the same way.

## 6. Forward-only repair `repairSchemaLedger`

### 6.1 Operation

A facade method beside the scan, exposed by the host to administrators. It writes in the Draft only what recorded native
schema writes would have written (ledger rows and schema history); it never migrates rows, and nothing committed
changes.

| Input | Type | Meaning |
| --- | --- | --- |
| `projectId`, `branchName` | string | The branch whose Draft is repaired. |
| `tableIds` | string[], optional | Head table ids; omitted → every Head table that fails (b). |
| `dryRun` | boolean, default `false` | Planning only (§6.3). |

Output `{ headRevisionId, draftRevisionId, dryRun, tables, renumbered }`; each table entry is
`{ tableId, outcome, migrationId?, patches?, removedPaths?, invalidRows?, blockedBy? }`; `renumbered` lists every
pending migration the plan renumbers, branch-wide (§6.3 step 4), including those of tables not requested. Errors: unknown
project or branch → not found; an unknown table id → validation error; an active async migration on the branch →
`MigrationLockedException` before any work.

### 6.2 Outcomes, first match wins

| Outcome | Condition | Operator action |
| --- | --- | --- |
| `unledgered` | Unledgered by the identity pass (§5.1). | Decided with the scan results (§7). |
| `ledgerDoesNotReplay` | Ledgered with a tainted slot in the Head replay. | Stays refused; replicas re-sync. |
| `notDamaged`, `draftOnlyDamage` | `RS` (replayed) equals `HS` (Head schema row); the Draft passes (b) or not. | None; or revert the table's structure. |
| `ledgerInconsistent` | The Draft lacks or alters a published Head migration row, a pending migration cannot be attributed (partial-changes §10.1), or a Draft history does not extend its Head history. | Revert the Draft natively. |
| `alreadyRepaired` | Replaying the pending migrations `P` from the Head schemas with `RS` reproduces the Draft schemas, and the Draft rows pass validation (§6.3 step 3). | Publish with a native or `{ all: true }` commit. |
| `repaired` | The `HS` baseline reproduces the Draft schema; the plan is accepted, verified and written. | Publish. |
| `rowsNeedMigration` | The schemas are consistent from one of the baselines, but Draft rows fail native data validation (for example shape (i) after a native revert relinked the Head's unmigrated rows, `draft-revision/commands/handlers/draft-revision-revert.handler.ts:27-50`). Nothing is written; the table stays refused. | Decided with the scan results (§7). |
| `patchNotReproducible` | The generated patch does not turn `RS` into `HS` or fails validation (§6.3). | Not repairable by this tool. |
| `blockedByDependency` | The plan of the table fails only because a damaged table coupled to it (§6.3) is not repaired in this call (not requested, or itself rejected); `blockedBy` lists them. | Repair them together, or resolve the blocking table first. |
| `needsDraftStructureRevert` | Neither baseline reproduces the Draft schema, or the table fails the combined verification for another reason (§6.3). | Revert the table's Draft structure natively, then rerun. |
| `stale` | Anything planning read or validated changed before the write (§6.4). | Rerun. |

### 6.3 Planning (read-only)

Planning runs in one `READ ONLY` RepeatableRead snapshot and pins the Head and Draft ids; per requested table it
evaluates the outcomes in order. Tables whose `HS` baseline reproduces their Draft schema are **candidates**. Repairs of
different tables can depend on each other through the pending migrations: a pending step reads another table when it
names it as a foreign-key target, is refused while it is referenced, or rewrites its foreign keys on a rename. Two
tables are **coupled** when such reads connect them, directly or through other tables. Candidates are therefore
evaluated together, in one plan, never one by one:

1. **Patch.** The diff from `RS` to `HS` by the schema toolkit's schema diff; applied to `RS` it must give `HS`. A field
   rename becomes remove and add; `removedPaths` lists the paths whose values Head-synced replicas lose when they apply
   the repair. The patch is validated at its insertion point, against the state replayed from the Head ledger
   (meta-schema, foreign-key targets as open slots, formulas, field names, history-patch schema), not against the
   current Draft; the repair writes no views content, so no views check applies.
2. **Baseline.** Replaying the Head ledger and the pending migrations without repairs gives **PASS0**, the tables that
   reproduce their Draft schema before planning; every other table failed before planning.
3. **Rows.** Every row of the Draft table version of each candidate and each `alreadyRepaired` table passes the
   synchronous data validation, schema **and** foreign-key references (`transactional/validate-data.handler.ts:39-57`),
   else `rowsNeedMigration` with `invalidRows` (count and sample ids) and the table leaves the candidates. Predicate (a)
   is not used. Planning records a **validation fingerprint** of exactly what it validated: per validated table version,
   its row count and an ordered digest of row `versionId` and `hash`; per table version that a foreign-key check
   consulted, an ordered digest of its row ids.
4. **Ids, once per plan.** One global sequence numbers the repairs of all current candidates in `tableId` order: the
   first id is `nextNativeMigrationId` of the last published migration, each next one the native rule of the previous,
   so a published timestamp ahead of the clock still gives distinct ids. Then, once, if any pending id is not greater
   than the last repair id, all pending migrations are renumbered after it in original order (`id`, `data.id`,
   `publishedAt` together), as partial-changes §6.8 renumbers a commit's remainder.
5. **Combined verification.** Replay the Head ledger, the repairs of all current candidates and the renumbered pending
   migrations. The plan passes when every candidate reproduces its Draft schema and every PASS0 table still does; a
   table outside PASS0 that is not a candidate may keep failing (an unrelated pre-existing failure, which renumbering
   changes only in its ids). Otherwise: a failing candidate is rejected, with `blockedByDependency` when it is coupled
   to a damaged table that is not a candidate (not requested, or already rejected), else `needsDraftStructureRevert`; a
   PASS0 table that fails rejects every candidate coupled to it (`needsDraftStructureRevert`). The reduced plan is then
   renumbered (step 4) and verified again. Rejection propagates through this loop: a candidate that passed only with a
   rejected repair fails in the next round and is rejected with `blockedByDependency` naming it. Each round removes at
   least one candidate, so planning ends after at most as many rounds as there were candidates.

`dryRun` and the scan stop here and report the planned outcomes.

### 6.4 Writing, verification and concurrency

One Serializable transaction through the native runner, with the migration-lock check and the fence shared (§3.9):

1. Re-read the Head and Draft ids, and the schema rows, ledger rows and table version ids planning read; recompute the
   validation fingerprint in SQL (one aggregate statement per table version). Any difference → `stale` for every table,
   nothing written. The recomputation runs inside the Serializable transaction, so a row change committed after its
   snapshot also conflicts; this catches, for example, a low-level `DraftRevisionApiService` row update that changes
   `data` and `hash` in place without schema validation (`src/index.ts:165`;
   `draft-revision/commands/handlers/draft-revision-update-rows.handler.ts:28-69, 95-103`).
2. Write, through the draft-revision writer with copy-on-write: each repair migration row
   `{ changeType: 'update', tableId: <Head id>, id, hash: objectHash(HS), patches }` with `publishedAt = id`; renumbered
   pending rows as new mutable versions (partial-changes §6.13 step 2); each Draft schema row's `meta` as the Head
   history prefix, the repair entry, then the pending entries, with `data` unchanged and a Draft-owned row version where
   it was shared; `hasChanges = true`. The views row is not copied: the repair does not change it.
3. Verify the **stored** Draft ledger: the published prefix is identical to the Head's (ids, `data`, `publishedAt`),
   every pending migration is attributable, ids strictly increase and pending ids exceed the last published one, every
   Draft history extends its Head history, and replaying the stored ledger reproduces the Draft schemas of the written
   tables. A failure rolls back and raises an error (a defect, not an outcome).

After the commit, endpoints of the Draft are notified. Rows are not revalidated inside the transaction (JSON validation
of a large table would exceed `TRANSACTION_TIMEOUT`); the fingerprint proves the validated input unchanged. A second run
plans `alreadyRepaired`; after a commit publishes the repair, `notDamaged`.

## 7. Decided with the scan results: ledger backfill and row remediation

Neither is a release gate; partial operations keep refusing the affected tables until a decision is implemented.

**Ledger backfill** for `unledgeredTable` findings. Proposal: `backfillSchemaLedger`, per table an `init` migration with
the Head schema row, positioned, numbered and verified as §6.3–§6.4, published by the next native or `{ all: true }`
commit. Limits: a replica holding a same-id table created outside the ledger fails on the `init`; a referrer whose
lineage starts before the backfilled table stays tainted. For `noMigrationTable`, creating a ledger competes with
exempting such projects, since no Head-synced replica can exist there (§13, question 2).

**Row remediation** for `rowsNeedMigration` findings. Candidate: reset the Draft schema row to the replayed schema and
run a native `updateTable` to the Head schema, which migrates and records at the cost of a full table update. It needs
its own freshness checks and failure verification, so it is designed only if the scan finds such tables; until then the
rows are fixed natively or the table stays refused.

## 8. Storage

No database schema change. `TableMigration.patches` holds the payload envelope (§3.1); `lockedBy` holds the claim token;
`phase` takes only `INIT`, `COPYING` and `SWAPPING` (records are deleted on success, so `VALIDATING`, `CLEANUP` and
`DONE` are no longer written); other columns and the unique key keep their meaning. System tables keep their formats.
The swap and the repair create Draft versions only and never update a version a non-Draft revision links.

## 9. Compatibility

| Observable change | Who sees it | Release note |
| --- | --- | --- |
| Async updates record an `update` migration and a history entry; Head exports carry large-table updates. | `getMigrations`, replicas | Yes |
| The Head and earlier revisions no longer change when an async migration completes. | Head readers | Yes |
| Async `updateTable` raises every schema error of the synchronous path; a trigger error no longer fails it; invalid rows fail the migration (`ROW_INVALID`) without retries. | API callers, status readers | Yes |
| New `errorMessage` codes (`REVISION_NOT_DRAFT`, `SOURCE_TABLE_REPLACED`, `SCHEMA_CHANGED`, `ROW_COUNT_MISMATCH`, `LEDGER_ID_TAKEN`, `LEDGER_UNAVAILABLE`, `LEDGER_NOT_RECORDED`, `STALLED`, `SWAP_STALLED`, `LEGACY_JOB`, `PAYLOAD_UNSUPPORTED`); `phase` no longer reports `VALIDATING`, `CLEANUP` or `DONE`. | Status readers | Yes |
| Payload envelope in `TableMigration.patches`; stop-the-world deploy of worker processes; legacy records disposed at startup. | Operators, direct readers of the column | Yes |
| Inline mode runs a recurring sweep; the progress deadline ignores heartbeats; a stalled `SWAPPING` owner is taken over. | Operators | Yes |
| Imported async updates into a Draft without a migration table fail with `LEDGER_UNAVAILABLE`. | Replica sync tools | Yes |
| Migrated rows carry file references. `backfillProjectFileBlobs` can relink earlier rows; its dry run reports inferred totals, not missing links. | Storage accounting | Yes |
| Endpoints of the Draft are notified after an async swap. | Hosts implementing `notifyEndpoints` | Yes |
| `abortMigration` guards its deletions and still rejects `SWAPPING`; the shadow table keeps the source's `createdAt`. | Admin callers, metadata readers | No |
| `applyMigrations` returns `applied` for a large `update` after its swap, with the source id; it drives the migration in-process in every mode and can last minutes. | Replica sync tools | Yes |
| New facade methods `scanSchemaLedger`, `repairSchemaLedger`; the repair can renumber pending migrations. | Operators, Draft-export consumers | Yes |

Status names, the lock (HTTP 423, `MIGRATION_LOCKED`), record deletion on success, and native commit and revert do not
change.

## 10. Acceptance scenarios

PostgreSQL through the real engine APIs with the committed-versions guard (partial-changes §14). Barriers sit at the
named boundary; fault hooks stop a worker at a named point. Damaged states native writes can no longer produce are SQL
fixtures repeating the old in-place swap, asserted first. Recovery scenarios assert `status`, `phase`, `startedAt` and
`completedAt` at every step.

**State machine and recovery**

- AM-01 An owner paused between T-claim and T-init resumes after (a) abort deleted the record, (b) a SQL fixture made it
  `CANCELLED` while keeping the paused owner's token, so only the status guard can stop T-init, (c) another worker took
  the lease → T-init matches nothing; the paused owner creates no shadow.
- AM-02 T-deadline while a batch waits before its commit → the batch's guard fails, its rows roll back.
- AM-03 Worker A pauses mid-batch past `lockTimeoutMs`, B claims and continues → A's batch rolls back, its heartbeat
  stops it, it cannot release B's lease or fail the record; every row is copied once.
- AM-04 Crash after batch k commits → the next claim resumes at batch k+1 without duplicates or gaps.
- AM-05 Inline restart within the old lease → the recurring sweep claims after expiry and completes.
- AM-06 Owner dies after T-swap-begin → another claim runs T-swap directly, once.
- AM-07 Fault hook right after the swap commits → no active record; a `remove` patch is applied once.
- AM-08 The connection drops after the swap commits → recovery finds nothing to do.
- AM-09 `notifyEndpoints` throws after the swap → completed, not repeated.
- AM-10 (a) A never-claimed record, (b) a `COPYING` owner heartbeating without batch progress, past the deadline →
  `CANCELLED`.
- AM-11 A `SWAPPING` owner heartbeating inside a swap that never commits → one T-takeover after its bound, even with
  several observers; the replacement, whose swap takes most of a bound, is not taken over and completes; the old owner's
  late commit is rejected. Owners that keep stalling → `FAILED` `SWAP_STALLED` after `maxRetries` takeovers. Owners
  that crash repeatedly after T-swap-begin, each replaced by a T-claim after lease expiry → `FAILED` `SWAP_STALLED`
  after `maxRetries` claims.
- AM-12 Legacy records, one per row of the disposition table → their terminal state at startup.
- AM-13 Both payload versions decode; an unknown version → `FAILED` `PAYLOAD_UNSUPPORTED`.
- AM-14 After a swap and a commit, a stale worker's batch writes nothing into the committed table.

**Swap and recording**

- AM-15 Committed table, new Draft sharing schema and views rows → Head row versions byte-identical; Draft-owned new
  ones; one `update` with the original patches and a native id; history entry; Head and Draft pass (b).
- AM-16 Schema row already Draft-owned → recorded; the Draft passes (b).
- AM-17 Source async update, native commit, Head-synced replica (below the threshold) → replica equals the source.
- AM-18 The views row is migrated in the Draft only.
- AM-19–AM-24 One fixture per re-check of §3.5 step 2 → `FAILED` with its code; nothing else written.
- AM-25 An imported migration whose Draft loses its migration table before the swap (SQL fixture) →
  `LEDGER_UNAVAILABLE`; with that re-check removed, the writer's `false` → `LEDGER_NOT_RECORDED`, never completion
  without the row. An interactive update in a Draft without a migration table completes without a ledger row.

**Cancellation and races**

- AM-26 Abort before T-swap-begin → abort wins; the worker stops; nothing linked.
- AM-27 Abort paused after its status read while T-swap-begin and the swap commit → its guarded deletion matches
  nothing, it deletes no shadow rows, the Draft table's rows are intact.
- AM-28 Abort and revert while `SWAPPING` is visible → rejected with today's messages.
- AM-29 Revert after a completed swap → the Draft links the Head table versions and drops the `update`; Head unchanged.
- AM-30 `createRevision` paused after its in-transaction lock read while an async start commits → one fails
  serialization; no active record belongs to a non-Draft revision.
- AM-31 Two starts on different tables, barrier after both lock reads → one record; the other gets `MIGRATION_LOCKED`.
- AM-32 (fence part 2) Public `createRevision` under its exclusive holder with a migration active → shared admission
  skipped, `MIGRATION_LOCKED`, holder released; also on an error and a timeout inside the operation; a swap waiting
  behind the holder then completes.

**Validation and files**

- AM-33a–j One per schema check of §3.3 step 3 (empty patches, patch schema, value schema, system table, meta-schema,
  missing foreign-key table, formula, field name, history-patch schema, views dry run) → the synchronous exception, no
  record. AM-33k A self-referencing foreign key is accepted.
- AM-34 Invalid row data in the third batch, and a row referencing a missing row → `ROW_INVALID`, `retryCount = 0`.
- AM-35 Property: async equals synchronous (data, `hash`, `schemaHash`, schema, history, ledger, views, blob links), ids
  and timestamps normalized; table `createdAt`, `system` and row `createdAt`, `publishedAt`, `meta` preserved.
- AM-36 File fields → migrated rows link their blobs; project bytes unchanged; an orphan sweep tombstones nothing used.

**`applyMigrations`**

- AM-37 Large `update` → `applied` after the swap with the source id; the next migration applies; no transaction or
  fence is held during the wait (instrumented).
- AM-38 Row failure → `failed` `ROW_INVALID`; the batch stops; no ledger row.
- AM-39 A repeated call while copying joins the record → `applied`; one record existed.
- AM-40 `disabled` mode: (a) the importer drives and observes, `applied`; (b) a repeated import joins a record whose
  owner then dies → the next tick after lease expiry claims and completes; (c) the local driver hits a transient batch
  failure and releases → the next tick reclaims and completes; (d) never two local drivers of one record (instrumented);
  (e) a driver stalled outside a transaction (fault hook) → the observer's deadline ends the wait (`CANCELLED`) and the
  resumed driver stops at its guard.
- AM-41 `polling` mode, another worker holds the lease → the importer observes; when that worker dies it takes over.
- AM-42 Abort during the wait → `failed` (`CANCELLED`); no ledger row.
- AM-43 Draft without a migration table → `failed` `LEDGER_UNAVAILABLE` before any mutation.
- AM-44 The trigger fails after the start commits → `updateTable` returns the `migrationId`; the sweep completes it.
- AM-45 Benchmark: a Head-synced replica of a 100k-row table follows partial and native commits, including async
  updates, with bounded RSS; replayed schemas equal the source.

**Scan**

- AM-46 One fixture per finding code, classification and shape (`unknown` with `rowDiagnostics: 'none'`, a mixed rename
  and own-step history) and per identity case: `init A`, `rename A → B` (ledgered); a removed and recreated id
  (`noLineage`); a failed rename (`unreplayableLedger` for the new id); an unattributable rename (`brokenLineage`).
- AM-47 Read-only: counts and per-table checksums unchanged; only read-only transactions.
- AM-48 Ten revisions sharing one ledger and schema version → one evaluation, ten revision ids.
- AM-49 Paging equals one call; `repair` equals a `dryRun`; `deferred` during an active async migration.

**Repair**

- AM-50 Shape (i), Draft on the shadow → `repaired`; a native commit passes (b); the replica applies the repair.
- AM-51 Shape (ii) → `repaired`.
- AM-52 A pending rename of the field the async migration added → repair before it, renumbered once, replica applies
  both.
- AM-53 Two independent damaged tables with the last published `publishedAt` ahead of the clock → distinct consecutive
  repair ids, one renumbering, combined plan verified.
- AM-54 Repair patch adding a foreign key to `B` while a pending migration renames `B` → validated at the insertion
  point; `repaired`.
- AM-55 Shape (i) after native revert → `rowsNeedMigration`, nothing written, still refused.
- AM-56 A row whose foreign key names a missing row → `rowsNeedMigration`.
- AM-57 Between planning and writing: a low-level `DraftRevisionApiService` update writing an invalid row, a native
  schema edit, a commit, a revert, another repair → `stale`, nothing written.
- AM-58 A Draft lacking a published migration row → `ledgerInconsistent`; nothing written.
- AM-59 Repair twice → `alreadyRepaired`; two concurrent repairs → one writes.
- AM-60 Unledgered (renamed lineage intact is not unledgered; removed and recreated; failed rename), unreplayable and
  Draft-only tables → their outcomes; nothing written.
- AM-61 `dryRun` returns a real run's plan and writes nothing; an active migration → `MIGRATION_LOCKED`.
- AM-62 Reciprocal foreign keys: damaged `A` and `B` reference each other, each with an unrecorded added field; pending
  migrations rename those fields, then rename both tables → both requested: both `repaired` in one plan, and a replica
  applies the result; only `A` requested → `A` `blockedByDependency` (`B`), nothing written.
- AM-63 Unrelated damage: `A` requested while unrelated damaged `B`, not requested, has a failing pending field rename →
  `A` `repaired`; `B`'s pending migrations are only renumbered and `B` keeps failing exactly as before.

## 11. Test strategy

- **PoC scenarios that reproduce the damage today** (PoC v2 `c86e86c`, `__tests__/async-migration.spec.ts`): the "known
  native defect" swap → AM-15; "blocks the structure whose change the ledger does not record" → AM-16; "native
  createRevision publishes a Head a replica cannot reproduce" → AM-17; benchmarks `async-structure` and `replica` →
  AM-45. Their pre-fix behaviour becomes the SQL fixture builder.
- **Barriers and fault hooks** use the engine's barrier support (`src/__tests__/utils/barrier.ts`, #89); every race
  asserts each admissible outcome, the final revision contents and the guard.
- **Mutation controls**, each shown red in the named scenario:

  | Mutation | Red in |
  | --- | --- |
  | T-init without its status guard; without its token guard | AM-01 (b); AM-01 (c) |
  | Deadline applied only when the heartbeat is stale | AM-10 (b) |
  | Heartbeat or release by id instead of token | AM-03 |
  | Batch without its leading guard | AM-03, AM-14 |
  | Record deletion outside the swap transaction | AM-07 |
  | `SWAPPING` recovered through T-init | AM-06 |
  | No T-takeover for a heartbeating `SWAPPING` owner; takeover deadline from `lastProgressAt` only; takeover without the epoch guard | AM-11 |
  | T-claim of `SWAPPING` does not count retries | AM-11 (repeated crashes) |
  | Swap ignoring the migration writer's `false` | AM-25 |
  | Abort deleting the shadow without its own successful guarded record deletion | AM-27 |
  | Start lock read outside the transaction | AM-31 |
  | Swap without copy-on-write; without the ledger row | AM-15; AM-17 |
  | No re-check | AM-19–AM-24 |
  | No row validation; no file registration | AM-34; AM-36 |
  | Importer awaiting its driver instead of observing on a timer | AM-40 (e) |
  | Observer not claiming records with an empty or expired lease | AM-40 (b), (c) |
  | No per-record local driver tracking | AM-40 (d) |
  | Shared admission not skipped under the exclusive holder | AM-32 |
  | Per-table repair id allocation | AM-53 |
  | Candidates accepted one by one | AM-62 |
  | Combined verification requiring every renumbered table to pass | AM-63 |
  | Repair validated against the current Draft | AM-54 |
  | Repair row validation without foreign keys | AM-56 |
  | Freshness by table version ids only, without the fingerprint | AM-57 |
  | Success without the published-prefix check | AM-58 |
  | Unledgered by a literal `init` of the current id | AM-46, AM-60 |
  | A scan that writes | AM-47 |

  The abort's link predicate (§3.6) is defence in depth with no red scenario: once the guarded deletion removed the
  record no swap can link the shadow.
- **Benchmarks**: async update and replica sync at 100k rows (AM-45); the scan and the repair planner on a
  production-sized copy, timed for the release gate.

## 12. Delivery

Landed prerequisites: #85–#92 (Overview). Each PR updates the engine's `docs/migration.md`.

| PR | Content | Depends on | Done when |
| --- | --- | --- | --- |
| 1 | Payload envelope and decoder; claim tokens; guarded transitions with phase effects; step results; recurring sweep, progress deadline, `SWAPPING` deadline and takeover; batch guard; legacy disposition at startup (§3.1, §3.2, §3.4 guard). | — | AM-01–AM-06, AM-10, AM-12–AM-14, with fixtures whose Draft already owns the schema and views rows, so today's swap writes no committed version. |
| 2 | Atomic swap: re-checks, native writers, ledger row from the payload and its `false` result, deletion in the transaction, notification; guarded abort (§3.5, §3.6). | 1 | AM-07–AM-09, AM-11, AM-15–AM-29. |
| 3 | Start: lock check inside the fenced transaction and one per revision, schema validation parity, ledger availability and imported-id check, trigger errors (§3.3). | 1 | AM-30, AM-31, AM-33, AM-43, AM-44. |
| 4 | Batch row validation, file references, explicit timeout (§3.4). | 1, 2 | AM-34–AM-36. |
| 5 | `applyMigrations` drive and observe (§4). | 2, 3, 4 | AM-37–AM-42, AM-45. |
| 6 | Swap fence admission (shared, without the lock check); the `exclusiveHeld` admission mode (§3.9). | 2; fence part 2 for the mode | Shared fence asserted in AM-15; AM-32 once part 2 exists. |
| 7 | Ledger replay with identity and schema passes (§5.1; #93). | — | Its slot, lineage, self-reference, atomicity and taint tests. |
| 8 | Repair planner, read-only, including coupling, combined verification and rejection, data and foreign-key row validation and the fingerprint (§6.2–§6.3). | 7, 4 (shared row validation) | AM-55, AM-56, AM-58, AM-60, the planning part of AM-61–AM-63. |
| 9 | Scan (§5). | 7, 8 | AM-46–AM-49. |
| 10 | Repair write with shared fence admission, fingerprint re-check and stored-ledger verification (§6.4). | 2, 4, 6, 8 | AM-50–AM-54, AM-57, AM-59, AM-61–AM-63. |
| 11 | Host exposure of scan and repair (host repositories); deploy PRs 1–6 with old workers stopped; run the scan on every deployment; review, including the host-side storage check (§13); decide §7. | 9, 10 | Findings reviewed; part of the partial-changes release gate. |

The production scan runs only after PRs 1–6 are deployed and no old worker runs, because before that an async swap can
still rewrite committed rows during the scan.

## 13. Decisions and open questions

1. **Legacy jobs at upgrade** (§3.2) — decided: async migrations in flight at upgrade are cancelled (`LEGACY_JOB`) and
   must be rerun, because an imported one cannot be recorded under its source id. Completing them under native ids
   would keep interactive changes but break the next sync of any replica that imported one.
2. **Projects without a migration table** (§7) — open, decided with the scan results: create a ledger for them, or
   exempt them from `unledgeredTable`.
3. **Files possibly lost before the fix** — decided: a host-side storage check is part of reviewing the scan results
   before release (§12, PR 11). The loss is an inference from code, not reproduced: migrated rows had no blob links, so
   blobs referenced only by them could be tombstoned once their Draft-owned source rows were cleaned up, and deleted
   from storage by the host.

## 14. Changes to partial-changes-v1

[partial-changes-v1](partial-changes-v1.spec.md) was updated accordingly in version 1.1 (§5.8, §6.9–§6.10, §8.3,
§8.4, §10.3, §12 and §13.4).

## Changelog

### Version 2 (2026-10-31)

- Guarded state machine with bounded recovery; atomic recorded swap; guarded abort; one migration per revision;
  synchronous validation and file references; `applyMigrations` drives and observes; payload envelope, no schema change.
- New `scanSchemaLedger` and `repairSchemaLedger` (ledger only); backfill and row remediation decided with scan results.
- Not carried over from v1: SSE, Redis, REST and GraphQL contracts, events and per-migration options (host concerns).

### Version 2.1 (2026-11-01)

- `repairSchemaLedger` returns `renumbered` once for the branch instead of per table entry (§6.1).

[async-row-migration-v1]: https://github.com/revisium/architecture/blob/master/specs/async-row-migration-v1.spec.md
