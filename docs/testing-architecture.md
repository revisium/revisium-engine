# Testing Architecture

## Purpose

This document defines the target test architecture for `revisium-engine`.

The goal is to keep real Prisma-backed database tests while making the test suite:

- easier to read
- faster to execute
- easier to extend
- more consistent in abstraction level

This document describes the intended default architecture for the repository.
It does not require every historical test file to be rewritten line-for-line into
the same shape. A refactor is considered complete when:

- the main feature areas follow these patterns by default
- new tests naturally use shared kits, scenarios, and assertion helpers
- the old primitive-heavy style is no longer the normal entrypoint for feature work
- the suite runs cleanly without process-forcing workarounds

## Principles

### Meaningful reading order first

A test file should present the most meaningful behavior first.

The reader should see:

- what behavior is covered
- what the system is expected to do
- what the important scenarios are

before they have to read wiring, builders, teardown, or low-level helpers.

Within a test file, prefer this order:

1. imports
2. constants and schemas that define the business context
3. `describe` and `it` blocks
4. assertion helpers used by multiple tests
5. scenario/setup helpers
6. lifecycle helpers such as `beforeAll`, `afterAll`, and teardown wrappers if they
   can be moved lower without hurting clarity

When lifecycle hooks stay near the top for technical reasons, keep them short and
push their detail into named helper functions placed lower in the file.

### TDD first

Tests should drive production design where practical.

Expected loop:

- write or adjust the failing test first
- implement the smallest production change that makes it pass
- refactor test and production code together

Test infrastructure refactors should follow the same idea:

- first capture current behavior in a clearer or narrower test
- then change helpers or module builders
- then remove duplication

### Tests are executable specifications

Each test should describe one behavior in business terms.

A reader should understand:

- what is being prepared
- what action is performed
- what observable result is expected

without tracing low-level storage mechanics in the test body.

### Behavior tests and invariant tests

The suite should distinguish between two honest test styles.

#### Behavior tests

Behavior tests assert externally meaningful outcomes:

- returned result
- visible schema
- visible rows
- revision state
- public API behavior

These should be the dominant style for feature and integration coverage.

They should read in domain language and avoid unnecessary inspection of internal
storage mechanics.

#### Invariant tests

Invariant tests assert critical internal guarantees when those guarantees are the
actual subject of the test.

Examples:

- new versions are created instead of mutating existing versions
- progress checkpoints are persisted after batch writes
- shadow tables are cleaned in the correct order
- swap updates metadata atomically

These tests are allowed to inspect internal database state, version ids, and
system-table records, but the test name and assertions should make that intent
explicit.

The goal is not to hide internals. The goal is to avoid mixing external behavior
assertions with unrelated implementation checks in the same test.

### Real database first

Feature and integration tests should continue to use the real Prisma database layer.
The refactor is about better structure and lower setup cost, not replacing database
coverage with mocks.

The repository now keeps that approach across the main feature areas.

### One abstraction level per test

A test should primarily express business intent, not low-level fixture plumbing.

Good:

- create draft with table and rows
- run update
- assert visible behavior

Bad:

- create branch graph
- create system tables
- create schema row
- create migration row
- create row version pair
- call feature under test

Low-level setup is still needed, but it should live behind dedicated fixture helpers.

Within one test body, avoid mixing:

- domain intent
- persistence wiring
- polling/timing control
- internal system-table mechanics

If those details are necessary, they should move into named helpers that keep the
test body at one level of abstraction.

### Object-oriented test design

Helpers should represent roles and scenarios, not just parameter bags.

Prefer:

- scenario builders that return meaningful test objects
- small assertion helpers with explicit names
- modules/builders with clear responsibility

Avoid:

- giant helper functions with many unrelated return fields
- procedural test scripts that manually assemble internal graph state
- broad mutable fixtures shared across unrelated behaviors

### Smallest module that proves the behavior

Use the lightest Nest module capable of exercising the behavior under test.

- unit tests: no database, mocked collaborators when appropriate
- feature integration tests: minimal module + real Prisma
- e2e tests: full `AppModule.forRoot()`

Feature tests should not default to app-sized module graphs.

### Scenario fixtures over persistence scripts

Fixture helpers should model test intent first.

Preferred:

- `givenDraftWithTable`
- `givenDraftWithRows`
- `givenLinkedTables`

Avoid exposing system-table details and version internals unless the test is
specifically about those internals.

Scenario helpers should be named from the point of view of behavior:

- `givenDraftWithTable`
- `givenDraftWithRows`
- `givenCommittedRevision`
- `givenMigrationInProgress`

Primitive helpers can still exist, but they should support scenarios rather than
be the default entrypoint for feature tests.

### Meaningful names over clever helpers

Prefer names that tell the reader what the test means.

Good:

- `givenDraftWithRows`
- `waitForMigrationCompletion`
- `expectDraftSchema`

Bad:

- generic helper names that only describe implementation mechanics
- giant setup helpers returning many unrelated ids
- helpers whose names hide side effects

## Current State

The repository now has shared builders and helpers that cover the main feature
areas:

- draft test kit
- migration test kit
- query test kit
- branch test kit
- database-service test kit
- engine e2e test kit
- scenario helpers for draft, migration, views, revision-changes, and row-query setup
- shared migration assertion helpers

The full Jest suite also exits cleanly without `--forceExit`.

This means the main goals of the refactor are achieved:

- shared setup is the default in the major feature areas
- repeated branch/revision/table/row wiring moved behind reusable helpers
- feature tests are generally written in behavior terms first
- e2e setup is isolated instead of inlined into the test file

Some low-level tests remain intentionally direct.
That is acceptable when:

- the test is already small and readable
- the test is about an internal invariant or a pure utility
- introducing another shared helper would hide the real subject of the test
- rewriting the file would only create stylistic churn without improving speed,
  readability, or maintenance

The goal is not uniformity for its own sake. The goal is to make the default test
style better and keep low-level tests explicit when explicitness is the right tradeoff.

## Ongoing Use

The refactor is complete enough that this architecture is now the default.

From this point:

- new tests should follow these patterns
- existing tests should be cleaned up opportunistically when feature work touches them
- low-level tests should stay direct when direct setup is the clearest expression of the invariant

The goal is steady-state maintenance, not another broad rewrite campaign.

## What Good Tests Should Look Like

### Example: feature integration test

```ts
describe('async table migration', () => {
  it('preserves rows and applies the new schema after swap', async () => {
    const draft = await givenDraftWithRows(kit, {
      rowCount: 15,
      schema: productSchemaV1,
      rows: (i) => ({ ver: i }),
    });

    const result = await kit.draftApi.updateTable({
      revisionId: draft.revisionId,
      tableId: draft.tableId,
      schema: productSchemaV2,
    });

    await waitForMigrationCompletion(kit, result.migrationId);

    await expectDraftSchema(kit, {
      revisionId: draft.revisionId,
      tableId: draft.tableId,
      schema: productSchemaV2,
    });

    await expectRows(kit, {
      revisionId: draft.revisionId,
      tableId: draft.tableId,
      count: 15,
    });
  });
});
```

This is the target style:

- business scenario first
- action next
- observable result last
- no low-level system-table setup in the test body

### Example: invariant test

```ts
describe('copy phase', () => {
  it('creates new row versions instead of mutating source rows', async () => {
    const draft = await givenMigrationCandidate(kit, {
      schema: productSchemaV1,
      rows: [{ id: 'row-1', data: { ver: 1 } }],
    });

    await startAndCompleteMigration(kit, {
      revisionId: draft.revisionId,
      tableId: draft.tableId,
      schema: productSchemaV2,
    });

    const versions = await loadRowVersions(kit, {
      rowId: 'row-1',
      tableId: draft.tableId,
    });

    expect(versions).toHaveLength(2);
    expect(versions[0].versionId).not.toBe(versions[1].versionId);
  });
});
```

This is also an honest test:

- the subject is an internal guarantee
- the assertions inspect internals directly
- the setup still stays at a readable scenario level

### Example: helper boundary

Scenario helpers should return only what the test needs.

Preferred:

```ts
const draft = await givenDraftWithRows(kit, {
  schema: productSchema,
  rows: [{ id: 'item-1', data: { name: 'A', price: 10 } }],
});

draft.revisionId;
draft.tableId;
draft.rowIds;
```

Avoid exposing internal setup state unless the test is explicitly about internals.

## Target Layers

### 1. Test Module Builders

The builder layer should be split by scope.

#### Shared test kits

Minimal shared foundation:

- `DatabaseModule`
- transaction service
- explicit feature imports/providers only
- shared storage override when needed

The repository now provides concrete kits for the main scopes:

- `createDraftTestKit`
- `createMigrationTestKit`
- `createQueryTestKit`
- `createBranchTestKit`
- `createDatabaseServiceTestKit`

These should be the default entrypoint for most Prisma-backed feature and service
tests. They should not eagerly import modules that the current test does not exercise.

#### Feature-specific presets

Small presets should exist for feature slices such as:

- draft
- migration
- views
- row queries
- branch
- database-backed service tests

Presets should import only what is necessary for that feature's tests.

#### `createEngineE2eTestKit()`

Reserved for true end-to-end tests that need:

- `AppModule.forRoot()`
- public service facade validation
- full integration across module boundaries

This repository now uses a dedicated engine e2e test kit for that role.

## 2. Fixture Layers

The fixture layer should be split into primitives and scenarios.

### Primitives

Low-level Prisma building blocks:

- create branch/revision graph
- create table version pair
- create row version pair
- create system-table records

These helpers are allowed to know about internal schema details.
They should remain small, explicit, and composable.

### Scenarios

High-level reusable test setup:

- `givenDraftWithTable`
- `givenDraftWithRows`
- `givenDraftWithLinkedTable`
- `givenMigrationCandidate`

Most specs should use scenarios, not primitives.
Scenarios should return a focused context object, not a dump of every created id.

## 3. Assertion and Flow Helpers

Common helpers should cover repeated operational behavior:

- migration polling/waiting
- module teardown
- common storage mocking
- frequently used query assertions

This avoids repeating timing loops, setup noise, and boilerplate expectations.

These helpers should read like verbs:

- `waitForMigrationCompletion`
- `expectDraftSchema`
- `expectRowsCount`
- `closeTestingModule`

## Suite Boundaries

### Unit tests

Use for logic that does not require real DB behavior.

Examples:

- pure schema helpers
- hash/diff utilities
- validation-only services with easily isolated collaborators

### Feature integration tests

This should be the dominant layer.

They should validate:

- handler/service behavior
- transactional behavior
- Prisma persistence effects
- feature-level invariants

They should not require full app bootstrap unless the feature truly depends on it.
This is the main target for Prisma-backed TDD in this repository.

### End-to-end tests

Keep these fewer and broader.

They should verify:

- facade surface
- cross-feature composition
- main business flows

They should not be the default way to test a single handler or internal service.

## Expected Outcomes

After the refactor:

- most tests read in domain terms instead of storage terms
- fewer suites rebuild oversized Nest modules
- helpers expose smaller, more intention-revealing APIs
- runtime and maintenance cost both improve without losing Prisma-backed confidence
- new tests are easier to write in a TDD flow because setup and assertions match
  feature language rather than storage internals

In practice, this now means:

- large feature areas should not introduce new ad hoc Nest module builders
- new feature tests should start from shared kits or scenario helpers unless the
  test is deliberately low-level
- direct primitive setup is still acceptable for small invariant tests and pure
  utility tests when it keeps the intent clearer
