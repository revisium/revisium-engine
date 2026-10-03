import { givenFormulaChanges } from '../support/formula-scenarios';
import { include } from '../support/select';
import { useChangesTestKit } from '../support/test-kit';

describe.skip('Draft Changes: formulas', () => {
  const kit = useChangesTestKit();

  it('blocks independent selection of a computed field', async () => {
    const f = await givenFormulaChanges(kit());
    const plan = await f.plan('commit', include(f.fields('/total')));
    expect(plan.status).toBe('blocked');
  });

  it('recomputes Head from the selected input', async () => {
    const f = await givenFormulaChanges(kit());
    await f.commitFields('/price');
    expect((await f.headRow())?.total).toBe(15);
  });

  it('recomputes the remaining Draft independently', async () => {
    const f = await givenFormulaChanges(kit());
    await f.commitFields('/price');
    expect((await f.draftRow())?.total).toBe(20);
  });

  it('recomputes Draft after discarding an input', async () => {
    const f = await givenFormulaChanges(kit());
    await f.discardFields('/multiplier');
    expect((await f.draftRow())?.total).toBe(15);
  });

  it('blocks a non-finite result under ordinary number validation', async () => {
    const f = await givenFormulaChanges(kit(), 'price / 0');
    expect((await f.plan('commit')).status).toBe('blocked');
  });
});
