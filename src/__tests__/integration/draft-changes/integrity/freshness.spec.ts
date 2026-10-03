import {
  givenTwoFieldChanges,
  givenRowChanges,
  type RowChangesScenario,
} from '../support/row-scenario';
import { include } from '../support/select';
import { useChangesTestKit } from '../support/test-kit';

describe.skip('Draft Changes: plan freshness', () => {
  const kit = useChangesTestKit();
  let f: RowChangesScenario;

  it('rejects a plan after an ordinary in-place Draft write', async () => {
    const plan = await f.plan('commit', include(f.fields('/a')));
    await f.updateDraftRow({ a: 3, b: 20 });
    expect((await f.execute(plan)).status).toBe('stalePlan');
  });

  it('performs no branch writes for a stale plan', async () => {
    const plan = await f.plan('discard', include(f.fields('/a')));
    await f.updateDraftRow({ a: 3, b: 20 });
    const before = await f.snapshot();
    await f.execute(plan);
    expect(await f.snapshot()).toEqual(before);
  });

  it('detects changed data even when its stored hash is unchanged', async () => {
    const plan = await f.plan('commit', include(f.fields('/a')));
    await f.tamperDraftRow({ a: 3, b: 20 });
    expect((await f.execute(plan)).status).toBe('stalePlan');
  });

  it('detects a write to an excluded child of a selected object', async () => {
    const nested = await givenRowChanges(kit(), {
      head: { obj: { a: 1, b: 10 } },
      draft: { obj: { a: 2, b: 20 } },
    });
    const plan = await nested.plan('commit', {
      include: [nested.fields('/obj')],
      exclude: [nested.fields('/obj/b')],
    });
    await nested.tamperDraftRow({ obj: { a: 2, b: 30 } });
    expect((await nested.execute(plan)).status).toBe('stalePlan');
  });

  beforeEach(async () => {
    f = await givenTwoFieldChanges(kit());
  });
  it('rejects a plan token presented for another branch', async () => {
    const plan = await f.plan('commit');
    const other = await givenTwoFieldChanges(kit());
    expect((await other.execute(plan)).status).toBe('blocked');
  });

  it('uses a fresh selection for each plan in the same transaction', async () => {
    await kit().transactionService.runSerializable(async () => {
      await f.plan('commit', include(f.fields('/a')));
      const second = await f.plan('commit', include(f.fields('/b')));
      await f.execute(second);
    });
    expect(await f.headRow()).toEqual({ a: 1, b: 20 });
  });
});
