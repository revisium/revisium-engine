import { givenReusedRowId } from '../support/identity-scenarios';
import { include } from '../support/select';
import { useChangesTestKit } from '../support/test-kit';

describe.skip('Draft Changes: reused row ID', () => {
  const kit = useChangesTestKit();

  it('blocks an ambiguous direct row selector', async () => {
    const f = await givenReusedRowId(kit());
    const plan = await f.plan('commit', include(f.rows(f.rowId)));
    expect(plan.status).toBe('blocked');
  });

  it('issues distinct refs for deletion and recreation', async () => {
    const f = await givenReusedRowId(kit());
    const deleted = await f.changeRef('deleted');
    const created = await f.changeRef('created');
    expect(deleted.value).not.toBe(created.value);
  });

  it('publishes only the deletion selected by ref', async () => {
    const f = await givenReusedRowId(kit());
    await f.apply(
      'commit',
      include({ kind: 'change', ref: await f.changeRef('deleted') }),
    );
    expect(await f.headRow()).toBeUndefined();
  });

  it('preserves the recreated row after publishing the old deletion', async () => {
    const f = await givenReusedRowId(kit());
    await f.apply(
      'commit',
      include({ kind: 'change', ref: await f.changeRef('deleted') }),
    );
    expect(await f.draftRow()).toEqual({ value: 9 });
  });
});
