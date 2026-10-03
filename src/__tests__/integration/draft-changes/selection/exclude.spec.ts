import { givenRemovedEditedField } from '../support/schema-scenarios';
import {
  givenTwoFieldChanges,
  givenRowChanges,
  type RowChangesScenario,
} from '../support/row-scenario';
import { all, except, include } from '../support/select';
import { useChangesTestKit } from '../support/test-kit';

describe.skip('Draft Changes: selection exclusions', () => {
  const kit = useChangesTestKit();
  let f: RowChangesScenario;

  it('keeps an excluded field unpublished', async () => {
    await f.apply('commit', except(all, f.fields('/a')));
    expect((await f.headRow())?.a).toBe(1);
  });

  it('publishes the remaining included field', async () => {
    await f.apply('commit', except(all, f.fields('/a')));
    expect((await f.headRow())?.b).toBe(20);
  });

  it('preserves an excluded field during discard', async () => {
    await f.apply('discard', except(all, f.fields('/a')));
    expect((await f.draftRow())?.a).toBe(2);
  });

  it('keeps an excluded row unpublished', async () => {
    await f.createRow('included', { a: 2, b: 20 });
    await f.apply('commit', except(all, f.rows(f.rowId)));
    expect(await f.headRow()).toEqual({ a: 1, b: 10 });
  });

  it('excludes a child of an included object', async () => {
    const nested = await givenRowChanges(kit(), {
      head: { obj: { a: 1, b: 10 } },
      draft: { obj: { a: 2, b: 20 } },
    });
    await nested.apply(
      'commit',
      except(include(nested.fields('/obj')), nested.fields('/obj/b')),
    );
    expect((await nested.headRow())?.obj).toEqual({ a: 2, b: 10 });
  });

  beforeEach(async () => {
    f = await givenTwoFieldChanges(kit());
  });
  it('blocks a value when its required schema field is excluded', async () => {
    const f = await givenRemovedEditedField(kit());
    const plan = await f.plan(
      'commit',
      except(include(f.fields('/extra')), f.schemaFields('/properties/extra')),
    );
    expect(plan.status).toBe('blocked');
  });
});
