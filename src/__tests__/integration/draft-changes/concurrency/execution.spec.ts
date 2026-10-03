import type { DraftChangesExecutionResult } from '../support/contract';
import { nanoid } from 'nanoid';
import { givenTwoFieldChanges } from '../support/row-scenario';
import { include } from '../support/select';
import { raceTransactions } from '../support/races';
import { useChangesTestKit } from '../support/test-kit';

describe.skip('Draft Changes: concurrent execution', () => {
  const kit = useChangesTestKit();

  it('applies only one of two distinct commit requests', async () => {
    const f = await givenTwoFieldChanges(kit());
    const plan = await f.plan('commit', include(f.fields('/a')));
    const results = await raceTransactions(kit().transactionService, [
      () => f.execute(plan),
      () => f.execute(plan),
    ]);
    expect(
      results.filter((result) => result.status === 'applied'),
    ).toHaveLength(1);
  });

  it('reports stale for the losing distinct commit request', async () => {
    const f = await givenTwoFieldChanges(kit());
    const plan = await f.plan('commit', include(f.fields('/a')));
    const results = await raceTransactions(kit().transactionService, [
      () => f.execute(plan),
      () => f.execute(plan),
    ]);
    expect(
      results.filter((result) => result.status === 'stalePlan'),
    ).toHaveLength(1);
  });

  it('replays one of two concurrent identical request IDs', async () => {
    const f = await givenTwoFieldChanges(kit());
    const plan = await f.plan('commit', include(f.fields('/a')));
    const requestId = nanoid();
    const results = await raceTransactions(kit().transactionService, [
      () => f.execute(plan, { requestId }),
      () => f.execute(plan, { requestId }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([
      'applied',
      'replayed',
    ]);
  });

  it('serializes commit and discard to one complete outcome', async () => {
    const f = await givenTwoFieldChanges(kit());
    const commit = await f.plan('commit', include(f.fields('/a')));
    const discard = await f.plan('discard', include(f.fields('/a')));
    await raceTransactions(kit().transactionService, [
      () => f.execute(commit),
      () => f.execute(discard),
    ]);
    const actual = { head: await f.headRow(), draft: await f.draftRow() };
    expect([
      { head: { a: 2, b: 10 }, draft: { a: 2, b: 20 } },
      { head: { a: 1, b: 10 }, draft: { a: 1, b: 20 } },
    ]).toContainEqual(actual);
  });

  it('allows independent branches to commit concurrently', async () => {
    const first = await givenTwoFieldChanges(kit());
    const second = await givenTwoFieldChanges(kit());
    const firstPlan = await first.plan('commit');
    const secondPlan = await second.plan('commit');
    const results = await raceTransactions(kit().transactionService, [
      () => first.execute(firstPlan),
      () => second.execute(secondPlan),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      'applied',
      'applied',
    ]);
  });
  it('orders an ordinary writer and a commit as complete operations', async () => {
    const f = await givenTwoFieldChanges(kit());
    const plan = await f.plan('commit', include(f.fields('/a')));
    await raceTransactions<DraftChangesExecutionResult | void>(
      kit().transactionService,
      [() => f.execute(plan), () => f.updateDraftRow({ a: 3, b: 20 })],
    );
    const actual = { head: await f.headRow(), draft: await f.draftRow() };
    expect([
      { head: { a: 2, b: 10 }, draft: { a: 3, b: 20 } },
      { head: { a: 1, b: 10 }, draft: { a: 3, b: 20 } },
    ]).toContainEqual(actual);
  });
});
