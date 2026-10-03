import { givenRowChanges } from '../support/row-scenario';
import { include } from '../support/select';
import { useChangesTestKit } from '../support/test-kit';

describe.skip('Draft Changes: entity lifecycle', () => {
  const kit = useChangesTestKit();

  it('publishes a newly created row', async () => {
    const f = await givenRowChanges(kit(), { head: { a: 1 }, draft: { a: 1 } });
    await f.createRow('new', { a: 2 });
    await f.apply('commit', include(f.rows('new')));
    expect(await f.headRow('new')).toEqual({ a: 2 });
  });

  it('discards a newly created row', async () => {
    const f = await givenRowChanges(kit(), { head: { a: 1 }, draft: { a: 1 } });
    await f.createRow('new', { a: 2 });
    await f.apply('discard', include(f.rows('new')));
    expect(await f.draftRow('new')).toBeUndefined();
  });

  it('publishes a row deletion', async () => {
    const f = await givenRowChanges(kit(), { head: { a: 1 }, draft: { a: 1 } });
    await f.removeRow();
    await f.apply('commit', include(f.rows()));
    expect(await f.headRow()).toBeUndefined();
  });

  it('restores a deleted row on discard', async () => {
    const f = await givenRowChanges(kit(), { head: { a: 1 }, draft: { a: 1 } });
    await f.removeRow();
    await f.apply('discard', include(f.rows()));
    expect(await f.draftRow()).toEqual({ a: 1 });
  });

  it('blocks a partial field selection for a created row', async () => {
    const f = await givenRowChanges(kit(), { head: { a: 1 }, draft: { a: 1 } });
    await f.createRow('new', { a: 2 });
    const plan = await f.plan(
      'commit',
      include({
        kind: 'rowFields',
        tableId: f.tableId,
        rowId: 'new',
        paths: ['/a'],
      }),
    );
    expect(plan.status).toBe('blocked');
  });
  it('publishes creation of a table', async () => {
    const f = await givenRowChanges(kit(), { head: { a: 1 }, draft: { a: 1 } });
    await f.createTable('new-table');
    await f.apply('commit', include({ kind: 'table', tableId: 'new-table' }));
    expect(await f.hasTable('head', 'new-table')).toBe(true);
  });

  it('discards creation of a table', async () => {
    const f = await givenRowChanges(kit(), { head: { a: 1 }, draft: { a: 1 } });
    await f.createTable('new-table');
    await f.apply('discard', include({ kind: 'table', tableId: 'new-table' }));
    expect(await f.hasTable('draft', 'new-table')).toBe(false);
  });

  it('publishes deletion of a table', async () => {
    const f = await givenRowChanges(kit(), { head: { a: 1 }, draft: { a: 1 } });
    await f.removeTable();
    await f.apply('commit', include({ kind: 'table', tableId: f.tableId }));
    expect(await f.hasTable('head')).toBe(false);
  });

  it('restores a deleted table on discard', async () => {
    const f = await givenRowChanges(kit(), { head: { a: 1 }, draft: { a: 1 } });
    await f.removeTable();
    await f.apply('discard', include({ kind: 'table', tableId: f.tableId }));
    expect(await f.hasTable('draft')).toBe(true);
  });
});
