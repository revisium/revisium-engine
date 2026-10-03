import {
  givenTwoFieldChanges,
  type RowChangesScenario,
} from '../support/row-scenario';
import { include } from '../support/select';
import { useChangesTestKit } from '../support/test-kit';

describe.skip('Draft Changes: selection union', () => {
  const kit = useChangesTestKit();
  let f: RowChangesScenario;

  it('unites overlapping field selections', async () => {
    const plan = await f.plan(
      'commit',
      include(f.fields('/a'), f.fields('/a', '/b')),
    );
    expect(plan.selected.fields).toBe(2);
  });

  it('does not count duplicate selectors twice', async () => {
    const plan = await f.plan(
      'commit',
      include(f.fields('/a'), f.fields('/a')),
    );
    expect(plan.selected.fields).toBe(1);
  });

  it('does not depend on selector order', async () => {
    const first = await f.plan(
      'commit',
      include(f.fields('/a'), f.fields('/b')),
    );
    const second = await f.plan(
      'commit',
      include(f.fields('/b'), f.fields('/a')),
    );
    expect(second.selected).toEqual(first.selected);
  });

  it('selects all row fields when paths are omitted', async () => {
    const plan = await f.plan(
      'commit',
      include({ kind: 'rowFields', tableId: f.tableId, rowId: f.rowId }),
    );
    expect(plan.selected.fields).toBe(2);
  });

  it('selects all table rows when rowIds are omitted', async () => {
    await f.apply('commit', include({ kind: 'rows', tableId: f.tableId }));
    expect(await f.headRow()).toEqual({ a: 2, b: 20 });
  });

  it('selects table rows by default', async () => {
    await f.apply('commit', include({ kind: 'table', tableId: f.tableId }));
    expect(await f.headRow()).toEqual({ a: 2, b: 20 });
  });

  it('does not select row edits for a table-only selector', async () => {
    await f.patchSchema([
      {
        op: 'add',
        path: '/properties/extra',
        value: { type: 'number', default: 0 },
      },
    ]);
    const plan = await f.plan(
      'commit',
      include({ kind: 'table', tableId: f.tableId, rows: 'none' }),
    );
    expect(plan.selected.rows).toBe(0);
  });

  beforeEach(async () => {
    f = await givenTwoFieldChanges(kit());
  });
});
