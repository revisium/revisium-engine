import { givenRowSwap } from '../support/identity-scenarios';
import {
  givenTwoFieldChanges,
  type RowChangesScenario,
} from '../support/row-scenario';
import { include } from '../support/select';
import { useChangesTestKit } from '../support/test-kit';

describe.skip('Draft Changes: rename identities', () => {
  const kit = useChangesTestKit();
  let f: RowChangesScenario;

  it('publishes the new row identity', async () => {
    await f.renameRow('renamed');
    await f.apply('commit', include(f.rows('renamed')));
    expect(await f.headRow('renamed')).toBeDefined();
  });

  it('removes the previous row ID when publishing a rename', async () => {
    await f.renameRow('renamed');
    await f.apply('commit', include(f.rows('renamed')));
    expect(await f.headRow(f.initial.rowId)).toBeUndefined();
  });

  it('restores the original row identity on discard', async () => {
    await f.renameRow('renamed');
    await f.apply('discard', include(f.rows('renamed')));
    expect(await f.draftRow(f.initial.rowId)).toBeDefined();
  });

  it('publishes the new table identity', async () => {
    await f.renameTable('renamed-table');
    await f.apply('commit', include({ kind: 'table', tableId: f.tableId }));
    expect(await f.headRow()).toBeDefined();
  });

  beforeEach(async () => {
    f = await givenTwoFieldChanges(kit());
  });
  it('publishes a row ID swap without losing an identity', async () => {
    const { f, selection } = await givenRowSwap(kit());
    await f.apply('commit', selection);
    expect(await f.headRow('first')).toEqual({ value: 2 });
  });

  it('restores original row identities when a swap is discarded', async () => {
    const { f, selection } = await givenRowSwap(kit());
    await f.apply('discard', selection);
    expect(await f.draftRow('first')).toEqual({ value: 1 });
  });

  it('publishes a rename of an empty existing table', async () => {
    await f.removeRow();
    await f.commitAll();
    await f.renameTable('renamed-empty');
    await f.apply('commit', include({ kind: 'table', tableId: f.tableId }));
    expect(await f.hasTable('head')).toBe(true);
  });
});
