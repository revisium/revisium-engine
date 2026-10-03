import { givenDependencyGraph } from '../support/dependency-scenarios';
import { givenRequiredDependency } from '../support/dependency-scenarios';
import { except, include } from '../support/select';
import { useChangesTestKit } from '../support/test-kit';

describe.skip('Draft Changes: required dependency closure', () => {
  const kit = useChangesTestKit();

  it('requires confirmation for a referenced Draft-only row', async () => {
    const { source } = await givenRequiredDependency(kit());
    const plan = await source.plan('commit', include(source.fields('/target')));
    expect(plan.status).toBe('confirmationRequired');
  });

  it('blocks execution without dependency confirmation', async () => {
    const { source } = await givenRequiredDependency(kit());
    const plan = await source.plan('commit', include(source.fields('/target')));
    expect((await source.execute(plan)).status).toBe('blocked');
  });

  it('publishes the referenced row after explicit confirmation', async () => {
    const { source, target, requiredRowId } =
      await givenRequiredDependency(kit());
    const plan = await source.plan('commit', include(source.fields('/target')));
    await source.execute(plan, {
      requiredAcknowledgmentToken: plan.requiredAcknowledgmentToken,
    });
    expect(await target.headRow(requiredRowId)).toEqual({ value: 2 });
  });

  it('blocks an excluded required dependency', async () => {
    const { source, requiredChoice } = await givenRequiredDependency(kit());
    const plan = await source.plan(
      'commit',
      except(include(source.fields('/target')), requiredChoice),
    );
    expect(plan.status).toBe('blocked');
  });

  it('exposes the exact dependency in plan details', async () => {
    const { source, target, requiredRowId } =
      await givenRequiredDependency(kit());
    const plan = await source.plan('commit', include(source.fields('/target')));
    const group = plan.requiredGroups[0];
    if (!group) {
      throw new Error('Expected a required dependency group.');
    }
    const details = await kit().changes.draftChangesPlanDetails(
      source.branch,
      plan.planToken,
      group.ref,
    );
    expect(
      details.effects.edges.map(({ node }) => ({
        tableId: node.tableId,
        rowId: node.rowId,
      })),
    ).toContainEqual({ tableId: target.tableId, rowId: requiredRowId });
  });
  it('includes transitive dependencies in the required closure', async () => {
    const f = await givenDependencyGraph(kit(), {
      left: 'middle',
      middle: 'end',
      end: 'end',
    });
    const plan = await f.plan('commit', include(f.rows('left')));
    expect(plan.required.rows).toBe(2);
  });

  it('terminates closure expansion for a dependency cycle', async () => {
    const f = await givenDependencyGraph(kit(), {
      left: 'right',
      right: 'left',
    });
    const plan = await f.plan('commit', include(f.rows('left')));
    expect(plan.required.rows).toBe(1);
  });

  it('publishes a confirmed dependency cycle as one valid candidate', async () => {
    const f = await givenDependencyGraph(kit(), {
      left: 'right',
      right: 'left',
    });
    const plan = await f.plan('commit', include(f.rows('left')));
    await f.execute(plan, {
      requiredAcknowledgmentToken: plan.requiredAcknowledgmentToken,
    });
    expect(await f.headRow('right')).toEqual({ link: 'left' });
  });
});
