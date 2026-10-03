import { givenDependencyGraph } from '../support/dependency-scenarios';
import { givenLinkedRows } from '../support/dependency-scenarios';
import { include } from '../support/select';
import { useChangesTestKit } from '../support/test-kit';

describe.skip('Draft Changes: foreign key rename effects', () => {
  const kit = useChangesTestKit();

  it('rewrites a referencing Head value when a row rename is committed', async () => {
    const { target, source } = await givenLinkedRows(kit());
    await target.renameRow('renamed');
    await target.apply('commit', include(target.rows('renamed')));
    expect((await source.headRow())?.target).toBe('renamed');
  });

  it('does not rewrite an unrelated string equal to the old row ID', async () => {
    const { target, source } = await givenLinkedRows(kit());
    const originalId = target.rowId;
    await target.renameRow('renamed');
    await target.apply('commit', include(target.rows('renamed')));
    expect((await source.headRow())?.label).toBe(originalId);
  });

  it('restores a referencing Draft value when a row rename is discarded', async () => {
    const { target, source } = await givenLinkedRows(kit());
    const originalId = target.rowId;
    await target.renameRow('renamed');
    await target.apply('discard', include(target.rows('renamed')));
    expect((await source.draftRow())?.target).toBe(originalId);
  });

  it('rewrites a schema FK when a table rename is committed', async () => {
    const { target, source } = await givenLinkedRows(kit());
    await target.renameTable('renamed-target');
    await target.apply(
      'commit',
      include({ kind: 'table', tableId: target.tableId }),
    );
    expect(await source.schemaField('head', 'target')).toMatchObject({
      foreignKey: 'renamed-target',
    });
  });
  it('rewrites a self-reference when the row is renamed', async () => {
    const f = await givenDependencyGraph(kit(), {});
    await f.renameRow('renamed');
    await f.apply('commit', include(f.rows('renamed')));
    expect((await f.headRow())?.link).toBe('renamed');
  });

  it('preserves an independently retargeted Draft reference', async () => {
    const { target, source } = await givenLinkedRows(kit());
    await target.createRow('other', { value: 2 });
    await source.updateDraftRow({ target: 'other', label: target.rowId });
    await target.renameRow('renamed');
    await target.apply('commit', include(target.rows('renamed')));
    expect((await source.draftRow())?.target).toBe('other');
  });
});
