import { givenRequiredDependency } from '../support/dependency-scenarios';
import { givenTwoFieldChanges, givenRowChanges } from '../support/row-scenario';
import { include } from '../support/select';
import { useChangesTestKit } from '../support/test-kit';

describe.skip('Draft Changes: planning', () => {
  const kit = useChangesTestKit();

  it('returns ready for a representable field selection', async () => {
    const f = await givenTwoFieldChanges(kit());
    expect((await f.plan('commit', include(f.fields('/a')))).status).toBe(
      'ready',
    );
  });

  it('returns empty when the branch has no changes', async () => {
    const f = await givenRowChanges(kit(), { head: { a: 1 }, draft: { a: 1 } });
    expect((await f.plan('commit')).status).toBe('empty');
  });

  it('does not write while planning', async () => {
    const f = await givenTwoFieldChanges(kit());
    const before = await f.snapshot();
    await f.plan('commit', include(f.fields('/a')));
    expect(await f.snapshot()).toEqual(before);
  });

  it('counts only the selected independent field', async () => {
    const f = await givenTwoFieldChanges(kit());
    expect(
      (await f.plan('commit', include(f.fields('/a')))).selected.fields,
    ).toBe(1);
  });

  it('reports the independent field that will remain pending', async () => {
    const f = await givenTwoFieldChanges(kit());
    expect(
      (await f.plan('commit', include(f.fields('/a')))).remaining.fields,
    ).toBe(1);
  });
  it('counts exactly the effects exposed by a required group', async () => {
    const { source } = await givenRequiredDependency(kit());
    const plan = await source.plan('commit', include(source.fields('/target')));
    const group = plan.requiredGroups[0];
    if (!group) {
      throw new Error('Expected a required group.');
    }
    const details = await kit().changes.draftChangesPlanDetails(
      source.branch,
      plan.planToken,
      group.ref,
    );
    expect(details.effects.totalCount).toBe(group.count);
  });

  it('does not write while reading plan details', async () => {
    const { source } = await givenRequiredDependency(kit());
    const plan = await source.plan('commit', include(source.fields('/target')));
    const group = plan.requiredGroups[0];
    if (!group) {
      throw new Error('Expected a required group.');
    }
    const before = await source.snapshot();
    await kit().changes.draftChangesPlanDetails(
      source.branch,
      plan.planToken,
      group.ref,
    );
    expect(await source.snapshot()).toEqual(before);
  });
  it('rejects confirmation from a different reviewed plan', async () => {
    const first = await givenRequiredDependency(kit());
    const second = await givenRequiredDependency(kit());
    const firstPlan = await first.source.plan(
      'commit',
      include(first.source.fields('/target')),
    );
    const secondPlan = await second.source.plan(
      'commit',
      include(second.source.fields('/target')),
    );
    const result = await first.source.execute(firstPlan, {
      requiredAcknowledgmentToken: secondPlan.requiredAcknowledgmentToken,
    });
    expect(result.status).toBe('blocked');
  });
});
