# PoC v2: Partial Commit and Revert by Snapshot Assembly

| Property | Value |
| --- | --- |
| Date | 2026-10-22 |
| Status | Draft |
| Supports | [ADR-001](../adr/ADR-001-partial-commit-and-revert.md), [partial-changes-v1](../specs/partial-changes-v1.spec.md) |
| Code | `poc/partial-changes-assembly@c86e86c` (not published; an archive tag may be pushed on request); base master `139eb7b` |
| Milestone commits | M1 `b197c1e`, M2 `3b35324`, M3 `3f9ad2d`, M4 `023b65f`, M5 `c86e86c` |
| Numbers | From the milestone reports, including their errata, and the run logs; times are inside the transaction unless marked |

## Goal and what was built

Goal: prove or refute **option A**: a partial commit or revert assembles the resulting revision from existing
immutable versions (Head versions, Draft versions, new versions only where a table or row mixes both), validates it
as a whole and writes it in one transaction; measure at 10k / 100k / 1M changed rows; report where it breaks.

Code: `src/features/partial-changes-poc/`, not registered in the app (M5: core 7,926 lines, tests 7,883, bench
5,736). Modules: **snapshot reader** (Head/Draft pairs by `createdId`, changed rows by a link anti-join); **catalogue**
of units (`field`, `rowCreate`, `rowDelete`, `rowReplace`, `rowRename`, `rowColumns`, one `structure`
per table, `views`, `sharedSchema`); **selection**; **closure** (all required units in one call, with reasons);
**assembler** (per table the Head, the Draft or a new version; merged rows only where a row mixes sides);
**validator**; **ledger plan** (published ids kept, remainder renumbered); **writer** (one Serializable
transaction); **listing**; **estimate/limits** (`tooLarge`); **fingerprint** (unsigned; mismatch → `stale`).

Test setup: Jest on PostgreSQL through the real engine APIs, native fixtures, native `createRevision` /
`revertChanges` as the `all: true` oracle, replicas synced `getMigrations` → `applyMigrations` → commit; benchmark
checks read all rows in SQL and fail the run (from M4). Sandbox: 2 CPU / 4 GB shared by Node and PostgreSQL 17, Node
heap 2.19 GB; runs vary up to ±2×.

## Milestones

| Milestone | Scenarios | What it proved |
| --- | --- | --- |
| M1 data path | 65/65 | Rows, fields, create/delete/replace/rename/swap committed and reverted by linking versions; formulas and hash recomputed for merged rows only; no dangling FK committed; `all: true` equals native; `stale`/`empty` retry; atomic rollback; each Serializable race resolved with one retry. Only the first group had a real red run (9/9) |
| M2 structure | 134/134 (66 + 68) | Structure unit per table (REQ-001.BR-007); published ids kept, remainder renumbered; a Head-synced replica accepted the partial and later commits of the fixed replica scenarios; a Draft-export replica fails (unsupported). The 8 random 20-step sequences only logged their step statuses in M2; they are asserted from M4 |
| M3 scale, races | 139/139 | Cost model at 10k–1M rows; nine fixes (F1–F9) removed quadratic and O(database) SQL; limits below |
| M4 review fixes, FK/files | 201/201 (139 + 62) | Suite-wide guard (committed versions readonly, byte-identical, unique ids) in all 24 specs; `listChanges` + property (6 seeds); `estimate` + `tooLarge`; asserted ledger sequences; 20 control patches; FK/files benchmark 0 failures in 42 runs, estimate equal to the measured `_RowToTable` writes in every run |
| M5 completeness, scope | 256/256 (201 + 55) | Every Draft difference a native read exposes belongs to exactly one unit; guard before every assembly; scoped reading; all benchmarks assert. The gate was re-run independently |

### Scale (M3, M4; long transaction timeout)

| Rows × changed | Preview | Partial commit | Partial revert | Per-row work | `all: true` | Native commit | Peak RSS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 10k × 10k | 3.9 s cold | 2.3 s (5k rows) | 1.4 s | 19.6 s (5k formula merges) | 1.9 s | 1.1 s | 0.57 GB |
| FK/files 10k (medians of 3) | 1.0 s | 1.9 s (required) | 1.1 s | 17.1–17.5 s (3,000 merges) | — | 0.6 s | 613 MB |
| 100k × 100k | 8.4 s | 43.9 / 26.7 s (50k rows) | 14.2 s | 142.5 / 99.7 s (50k merges) | 20.2 s | 12.0 / 11.2 s | 1,029 MB |
| FK/files 100k (medians of 3) | 9.6 s | 19.1 s (required) | 9.9 s | 158.1–172.2 s (30,000 merges) | — | 6.3 s | 1,355 MB |
| 300k × 300k | 20.7 s | 70.0 s | 36.9 s | 337.6 s | 62.9 s | 30.6 s | 1.76 GB |
| 1M × 1k | 1.7 s | 64.2 s (500 rows) | 2.8 s | 65.1 s (500 merges; ~61 s is the link copy) | 4.1 s | 7.8 s | 0.28 GB |
| 1M × 1M | out of memory | not run | not run | not run | not run | 557.6 s | — |

Cases behind the SPEC's 100k ranges: preview 8.4–9.6 s = `preview` 8.4 s (100k × 100k) and `preview-required`
9.6 s, 3-step closure (FK/files 100k); commit 19.1–43.9 s = `commit-required` (FK/files 100k) to `commit-rows`
(100k × 100k, second run 26.7 s); revert 9.9–14.2 s = `revert-required` (FK/files 100k) to `revert-rows`
(100k × 100k); per-row work 99.7–172.2 s = `commit-field` 99.7 / 142.5 s (100k × 100k, 50,000 formula merges) and
`revert-photos` 158.1, `commit-prices` 169.0, `commit-photos` 172.2 s (FK/files 100k, 30,000 merges with formulas
and files; file registration 102.4–107.8 s of it). Native `createRevision` at 100k: 9.5–12.0 s in three runs.

- **Cost per unit**: ~4.4 KB of planning heap per changed row (10k 0.18 GB, 100k ~0.6–0.7 GB, 300k 1.3 GB); ~1.6–1.7 ms
  per merged row with a formula (88% of merge CPU in `evaluateFormulas`); ~3.4–3.7 ms of file registration per
  merged row with a file. A mixed table copies its full link set: the 500-row commit in a 1M-row table took 64.2 s
  (~61 s link copy) vs native 7.8 s; `commit-required` at 100k wrote 200,000 links for 30,000 applied rows (8.4 s).
- **Broke**: 1M × 1M ran out of the 2 GB heap after 685 s (before the fixes, not re-run). Under the default 15 s
  transaction, 100k `commit-rows` and `all: true` failed with P2028 after 17.7 s / 19.8 s, the 1M × 1k commit after
  61 s (Prisma does not cancel the statement); ~5k formula merges already took 11.0–19.6 s.
- **Refusals** (defaults 100,000 changed rows, 250,000 links per mixed table, 10,000 per-row-work rows, 180 s): every
  100k merge case of M4 is refused (30,000 merges); the 100k required-unit cases pass; nothing at 10k is refused.
- **Structure, 100k rows**: commit `tables: ['items']` with renumbering 12.2 s (9.7 s locking), with 50k unselected
  edits 107 s, native commit 11.9 s, revert 2.3 s. Replica: async path reported `applied` after 1.5 s while
  `COPYING`, then the replica commit hit `MigrationLockedException` and the process ran out of the 2 GB heap after
  ~597 s; sync path P2028 after ~145 s, or P2029 after ~165 s at 1.9 GB RSS with a long timeout.
- **Races** (5,000-row tables, 10/25/50 writers): unfenced partial commit, partial revert and native `createRevision`
  fail after 30 Serializable attempts (123–175 s); no lost write, every consistency check passed. A bench-only fence
  (advisory lock, monkey-patched writers) applied the commit in 1 attempt, 1.4–1.5 s.

### M5 numbers

- Completeness properties, 6 seeds each: reverting the listed units one by one leaves the Draft equal to Head in every
  compared column (`hasChanges = false`); committing them one by one gives a Head equal to native `createRevision` of
  the original Draft. Before the fix the commit property failed for seeds 13 and 34 (`publishedAt` lost).
- Scoped vs full property, 6 seeds × 4 random selections, commit and revert: the scoped plan equals the plan that reads
  every table (status, fingerprint, counts, required, blockers, unmatched, estimate except `changedRows`, ledger,
  written rows); `scope-without-foreign-keys` breaks it (seed 61).
- Scoped benchmark (3 runs per cell, default limits, all 18 runs passed their checks, peak RSS ≤ 549 MB):

| One-field operation on `notes` (1,000 rows) | Busy: 200,000 changed unrelated rows | Quiet: no unrelated changes |
| --- | --- | --- |
| commit `/price`, median (min–max) | 58 ms (45–68) | 51 ms (48–56) |
| revert `/price` | 48 ms (34–76) | 38 ms (38–45) |
| commit reading every table (M4 behaviour), wall | `blocked: tooLarge` after 2.2 s (2.2, 2.2, 18.3 s) | `applied` in 44–124 ms |

- Smoke runs at 10k, all asserted: scale 9/9 (commit-field 10.7 s, 5,000 formula merges); structure 6/7 in the first
  run (async case corrected); FK/files 9/9; races 8/8 consistent.

## Mutation controls

Each control is a saved patch: apply, run the named specs, see them fail, reverse with `git apply -R`. **34 controls
were shown red across M4–M5**: 20 against the M4 code `023b65f` (21 red runs; one also fails a benchmark) and 14
against `c86e86c` (13 new plus one added by a PoC review). Four M4 patches no longer apply to the final code
(`read-committed`, `no-size-guard`, `block-every-structure-commit`, `draft-keeps-unitless-versions`; `git apply
--check` against `c86e86c`), so **30 apply to the current code**. The M1–M2 prose controls were re-created in M4.

| Guarantee | M4 | M5 |
| --- | --- | --- |
| Isolation, immutability | `read-committed`, `mutable-merged-head-rows`, `draft-keeps-unitless-versions` | `no-row-lock-on-structure-commit`, `guard-forgets-every-observation` |
| Dependencies, ledger | `no-row-dependency-checks`, `no-table-dependencies`, `no-table-dependencies-no-ledger-validation`, `no-structure-binding-of-changed-fk-values`, `transient-units-not-grouped`, `no-renumbering`, `block-every-structure-commit` | `scope-without-foreign-keys` |
| Freshness, binding | `fingerprint-without-system-rows`, `fingerprint-without-draft-rows`, `fingerprint-without-operation`, `required-without-expected-allowed`, `unmatched-ignored` | `fingerprint-without-row-columns`, `stale-before-too-large` |
| Completeness, scope | `list-without-side-head` | `reader-without-row-columns`, `reader-without-row-columns-and-relink-check` (reproduces the lost `publishedAt` edit; 12 tests fail on an independent re-run), `limit-counts-whole-draft`, `listing-reads-all-tables`, `unread-tables-relinked`, `rename-selector-as-row-with-field-exclusions` |
| Guard, planning, files | `no-size-guard`, `read-write-planning-transaction`, `files-registered-before-relink`, `bench-merge-without-formulas` | `estimate-after-assembly`, `per-row-work-without-files`, `planning-under-transaction-timeout` |

## Native defects and behaviours found (stage-0 inputs)

| Finding | Source |
| --- | --- |
| Async migration writes no migration row or history; its swap rewrites the shared Head schema (and views) row in place on the first async update of a committed table in a new Draft (caught by the M4 guard); a Head-synced replica never receives it. Consequence: partial structure commit is blocked for every table of 1,000 rows or more until stage 0 | M2, M4 |
| A completed async migration leaves no pending migration and a rewritten Head schema: the structure is invisible from both sides (preview `empty`, `unmatchedSelector`); async is on by default since v0.7.0 | M5 |
| Row and table rename rewrite at most 100 referrers; the 101st keeps a dangling FK native `createRevision` would commit (the PoC blocks it); the row-removal guard checks at most 100 referrer tables (code reading) | M1 |
| Migration lock checked outside the transaction (`ApiCreateRevision`, all API writers); `applyMigrations` checks ids outside a transaction, one transaction per migration, stops at the first failure | M1, code reading |
| From code, not reproduced: native views writes are not Serializable (check, then in-place update); orphan GC deletes in-flight async shadow tables; async start validates only the meta-schema | Code reading |
| From code: row `schemaHash` equal to the schema hash is not a native invariant — a table rename rewrites referencing schema rows without re-hashing their rows, and the low-level row API writes any value; native writers skip the ledger when a revision has no migration table. So the Head schema check refuses on ledger replay only, and unledgered tables are refused | Code reading |
| Copy-on-write of a committed table fails above 32,767 bind parameters (P2029): fails at 32,770 and 32,800 rows, works at 1,000; replicas hit it in `applyMigrations` | M3, M5 |
| `createRevision` locks rows with a scan (557.6 s for 1M changed rows, 7.8 s for 1k changes in a 1M-row table); synchronous `updateTable` and the in-process async migration of 100k rows run out of the 2 GB heap, the async one stays `COPYING` and locks the branch | M3 |
| Formulas re-parsed per row (`evaluateFormulas`); file references registered per row, several queries each (102–108 s for 30,000 rows) | M3, M4 |
| Long Serializable commits (partial and native) starve under continuous writers; bench-only evidence, fence only as a bench prototype | M3, M5 |
| `publishedAt` is a row column edited through a `RowPublishedAt` data field that stores `''`, so `hash` ignores it (root cause of the lost `publishedAt` edit) | M5 |
| `hasChanges` compares versions, browse compares hashes (no-op versions); native update mutates a mutable row in place; Prisma's default 5 s timeout for `run()` without options, and P2028 does not cancel the running statement | M1, M3 |

## Reviews

Two independent reviews of the PoC, after M3 (`3f9ad2d`) and after M4 (`023b65f`), accepted it as a base for the ADR
and SPEC with conditions. M4 fixed and tested the conditions of the first review or moved them to stage 0 and the
SPEC; M5 closed and tested those of the second, including the Draft `publishedAt` edit that the M4 relink dropped.
The second review confirmed all 20 M4 controls as real.

## Limits of the evidence

- One 2 CPU / 4 GB sandbox: cost shape, not SLAs. Most M3 cells are single runs; M4 and the M5 scoped benchmark used 3
  runs per cell. Limits must be re-measured (≥ 3 runs, production-like hardware) before they are final.
- Single dataset shapes: one table with one formula (M3); one referrer table, a 3-step closure, one file field (M4);
  one FK-free unrelated table (M5). The 100k structure migration was native on one row; the 100k async replica never
  completed. Smoke-only: the 10k asserting re-runs of M3/M4 benchmarks (one run or two repeats per case).
- Never built: the Head schema check (ledger replay, unledgered tables) and the repair; keyset paging inside a
  table; the fence beyond the bench prototype; a database-enforced deadline and a per-operation attempt cap (the
  PoC used the global retry cap, 30 in tests); exact selectors on required units; post-commit notifications; stage 0.
- Untested: JSON Pointer escapes; applied reverts of swaps and reused ids; Head-id fallback after a concurrent rename;
  the views fallback branch; races with files; repeated or in-array `RowPublishedAt`; shared schema → using tables.

## Reproduce

The milestone reports, run logs and control patches are kept with the PoC and are not published in this repository;
each report lists the commands that reproduce its runs.
