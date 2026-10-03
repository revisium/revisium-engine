import { givenTwoFieldChanges, givenRowChanges } from '../support/row-scenario';
import { givenRenamedField } from '../support/schema-scenarios';
import { useChangesTestKit } from '../support/test-kit';

describe.skip('Draft Changes: consumer reads', () => {
  const kit = useChangesTestKit();

  it('counts independently changed row fields', async () => {
    const f = await givenTwoFieldChanges(kit());
    const snapshot = await kit().changes.draftChanges(f.branch);
    expect(snapshot.counts.fields).toBe(2);
  });

  it('reports an empty semantic diff', async () => {
    const f = await givenRowChanges(kit(), { head: { a: 1 }, draft: { a: 1 } });
    expect((await kit().changes.draftChanges(f.branch)).isEmpty).toBe(true);
  });

  it('returns selectable refs for independent row edits', async () => {
    const f = await givenTwoFieldChanges(kit());
    const page = await f.rowChanges();
    expect(page.changes.filter((leaf) => leaf.selectable)).toHaveLength(2);
  });

  it('does not report a schema-only rename as a user value edit', async () => {
    const f = await givenRowChanges(kit(), { head: { a: 1 }, draft: { a: 1 } });
    await f.patchSchema([
      { op: 'move', from: '/properties/a', path: '/properties/b' },
    ]);
    expect(
      (await f.browseRows()).edges
        .flatMap(({ node }) => node.refs)
        .filter((leaf) => leaf.selectable),
    ).toHaveLength(0);
  });

  it('exposes schema changes separately from row edits', async () => {
    const f = await givenRenamedField(kit());
    const table = await kit().changes.draftTableChanges(f.branch, f.tableId);
    expect(table.schemaChanges.length).toBeGreaterThan(0);
  });
});
