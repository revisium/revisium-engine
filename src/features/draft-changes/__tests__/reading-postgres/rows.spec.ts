import { givenReadingScenario } from './support/reading-scenario';
import { useReadingTestKit } from './support/reading-test-kit';

describe('Draft Changes reader: changed rows', () => {
  const kit = useReadingTestKit();

  it('reports row lifecycle and rename IDs from both roles', async () => {
    const scenario = await givenReadingScenario(kit(), {
      head: { title: 'Head' },
      draft: { title: 'Draft' },
      rowId: 'product-old',
    });
    await scenario.renameDraftRow('product-new');

    const result = await kit().changes.draftChangedRows({
      ...scenario.branch,
      tableId: scenario.tableId,
    });

    expect(result.edges[0]?.node).toMatchObject({
      tableId: scenario.tableId,
      rowId: 'product-new',
      previousRowId: 'product-old',
      changedFieldCount: 1,
    });
    expect(result.edges[0]?.node.changes).toContain('renamed');
    expect(result.edges[0]?.node.changes).toContain('updated');
    expect(result.edges[0]?.node.changes).not.toContain('created');
    expect(result.edges[0]?.node.changes).not.toContain('deleted');
  });

  it('lists exact catalogue refs for changed row fields', async () => {
    const scenario = await givenReadingScenario(kit(), {
      head: { title: 'Head', price: 10 },
      draft: { title: 'Draft', price: 20 },
    });
    const catalogue = await scenario.readCatalogue();

    const result = await kit().changes.draftChangedRows({
      ...scenario.branch,
      tableId: scenario.tableId,
    });
    const rowRefs = result.edges[0]?.node.refs.map(({ ref }) => ref.value);
    const catalogueRefs = catalogue.entries
      .filter(({ kind }) => kind === 'rowField')
      .map(({ ref }) => ref.value);

    expect(rowRefs?.sort()).toEqual(catalogueRefs.sort());
  });

  it('keeps attached row refs bounded while reporting all changed fields', async () => {
    const head = Object.fromEntries(
      Array.from({ length: 101 }, (_, index) => [`field${index}`, 0]),
    );
    const draft = Object.fromEntries(
      Array.from({ length: 101 }, (_, index) => [`field${index}`, 1]),
    );
    const scenario = await givenReadingScenario(kit(), {
      head,
      draft,
    });

    const result = await kit().changes.draftChangedRows({
      ...scenario.branch,
      tableId: scenario.tableId,
    });
    const row = result.edges[0]?.node;

    expect(row?.changedFieldCount).toBe(101);
    expect(row?.refs.length).toBeLessThanOrEqual(100);
    expect(row?.hasMoreChanges).toBe(true);
  });
});
