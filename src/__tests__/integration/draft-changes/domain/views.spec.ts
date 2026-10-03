import { givenViewChanges } from '../support/view-scenarios';
import { givenRenamedViewField } from '../support/view-scenarios';
import { include } from '../support/select';
import { useChangesTestKit } from '../support/test-kit';

describe.skip('Draft Changes: views', () => {
  const kit = useChangesTestKit();

  it('restores a migrated column reference when schema is discarded', async () => {
    const view = await givenRenamedViewField(kit());
    await view.f.apply('discard', include(view.f.schemaFields()));
    expect((await view.draftView())?.columns?.[0]?.field).toBe('data.price');
  });

  it('preserves an independent view name during schema discard', async () => {
    const view = await givenRenamedViewField(kit());
    await view.f.apply('discard', include(view.f.schemaFields()));
    expect((await view.draftView())?.name).toBe('Draft view');
  });
  it('publishes a view selected by its opaque ref', async () => {
    const f = await givenViewChanges(kit());
    const table = await kit().changes.draftTableChanges(f.branch, f.tableId);
    const ref = table.viewsChanges?.find((leaf) => leaf.selectable)?.ref;
    if (!ref) {
      throw new Error('Expected a selectable view ref.');
    }
    await f.apply('commit', include({ kind: 'change', ref }));
    const views = await kit().views.getTableViews({
      revisionId: await f.revisionId('head'),
      tableId: f.tableId,
    });
    expect(views.views[0]?.name).toBe('Draft view');
  });
});
