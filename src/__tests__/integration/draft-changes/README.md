# Draft Changes acceptance tests

This suite specifies branch-scoped commit/discard with reviewed plans. Generic
revision comparison (`revisionChanges`, `tableChanges`, `rowChanges`) belongs to
the existing `revision-changes` tests.

Every suite intentionally uses `describe.skip`: the runtime implementation is
not part of this PR or available on `master`. Jest still imports and collects the
tests, and TypeScript checks their bodies and support code. A skipped run does
not prove the behavior described by the assertions.

## Test style

Each test proves one behavior. Setup uses existing database fixtures; short
scenario methods call the actual consumer API. Expected values stay in the spec.
Each test creates its own branch and data. There are no mocked commit/discard
results and no empty test bodies.

`commitFields` and `discardFields` plan and execute a ready operation. They fail
when planning or execution is unsuccessful and never acknowledge required effects
automatically. Plan, confirmation, freshness, and replay tests call those steps
separately.

## Files

| Directory      | Subjects                                                                      |
| -------------- | ----------------------------------------------------------------------------- |
| `data`         | Full/partial commit and discard, JSON values, row/table lifecycle             |
| `selection`    | Selector union, defaults, overlap, duplicates, hard exclusions                |
| `identity`     | Renames, swaps, empty tables, reused IDs and exact refs                       |
| `schema`       | Schema-only/partial operations, values across renames, migration history      |
| `dependencies` | Required closure, chains/cycles, FK rename effects                            |
| `domain`       | Formulas, files, views, repair of invalid Draft state                         |
| `consumer`     | Browse, pagination, plan counts/details, confirmation                         |
| `integrity`    | Freshness, replay, rollback, immutable history and COW                        |
| `concurrency`  | Barrier-synchronized execution races and migration locks                      |
| `support`      | Runtime binding, scenario fixtures, state readers, failure hooks and barriers |

## Collection and activation

Collect the suite without opening database connections:

```sh
pnpm exec jest src/__tests__/integration/draft-changes --runInBand
pnpm run tsc
```

To enable a group, integrate the Draft Changes runtime, configure a disposable
test PostgreSQL, and replace `describe.skip` with `describe` in that spec. Run one
file or directory at a time:

```sh
pnpm exec jest src/__tests__/integration/draft-changes/schema --runInBand
```

`support/contract.ts` is a test-owned snapshot of the consumer contract. It adds
no package exports or runtime API. Deferred module/provider imports are confined
to `support/test-kit.ts`; replace that binding with checked static imports when
the implementation lands. The shared Draft test kit accepts additional Nest
imports and migration options without changing defaults for existing suites.

The test kit disables automatic migration workers. Lock tests seed explicit
statuses through the existing migration command; they test exclusion at each
status, not worker transitions. Execution races synchronize inside real
transactions using a barrier. Failure tests run the real mutation before a narrow
injected error and check rollback, including receipts and file state.

These are finite acceptance scenarios. Large data benchmarks and worker-phase
recovery scenarios remain separate from this suite.

## Pending expectations in the local PoC

An enabled run against the separate local PoC passed 155 of 159 cases. The
remaining expectations are preserved in this skipped suite:

- Consumer reads reject active migrations in `PENDING`, `COPYING`, and `SWAPPING`.
- A commit reuses an already shared, unchanged row version.

These four cases must pass before enabling the affected suites. The PoC
implementation and fixes for these expectations are outside this PR.
