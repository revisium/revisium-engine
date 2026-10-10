import { givenReadingScenario } from './support/reading-scenario';
import { useReadingTestKit } from './support/reading-test-kit';
import { getStringSchema } from '@revisium/schema-toolkit/mocks';

describe('Draft Changes reader: changed tables', () => {
  const kit = useReadingTestKit();

  it('returns changed table rows with current and previous public IDs', async () => {
    const scenario = await givenReadingScenario(kit(), {
      head: { title: 'Head' },
      draft: { title: 'Draft' },
      tableId: 'products-old',
    });
    await scenario.renameDraftTable('products-new');

    const result = await kit().changes.draftChangedTables({
      ...scenario.branch,
    });

    expect(result.totalCount).toBe(1);
    expect(result.edges[0]?.node).toMatchObject({
      tableId: 'products-new',
      previousTableId: 'products-old',
      changedRowCount: 1,
    });
    expect(result.edges[0]?.node.changes).toContain('renamed');
    expect(result.edges[0]?.node.changes).toContain('updated');
    expect(result.edges[0]?.node.changes).not.toContain('created');
    expect(result.edges[0]?.node.changes).not.toContain('deleted');
  });

  it('keeps schema change leaves on the table item and out of row edit counts', async () => {
    const scenario = await givenReadingScenario(kit(), {
      head: { price: 10 },
    });
    await scenario.patchDraftSchema([
      { op: 'move', from: '/properties/price', path: '/properties/cost' },
    ]);

    const [tables, rows] = await Promise.all([
      kit().changes.draftChangedTables({ ...scenario.branch }),
      kit().changes.draftChangedRows({
        ...scenario.branch,
        tableId: scenario.tableId,
      }),
    ]);

    expect(tables.edges[0]?.node.schemaFieldCount).toBeGreaterThan(0);
    expect(tables.edges[0]?.node.changes).toContain('updated');
    expect(tables.edges[0]?.node.changes).not.toContain('created');
    expect(tables.edges[0]?.node.changes).not.toContain('deleted');
    expect(rows.totalCount).toBe(0);
  });

  it('does not report default materialization from an added field as a row edit', async () => {
    const scenario = await givenReadingScenario(kit(), {
      head: { title: 'Same' },
    });
    await scenario.patchDraftSchema([
      {
        op: 'add',
        path: '/properties/tag',
        value: { type: 'string', default: '' },
      },
    ]);

    const [tables, rows] = await Promise.all([
      kit().changes.draftChangedTables({ ...scenario.branch }),
      kit().changes.draftChangedRows({
        ...scenario.branch,
        tableId: scenario.tableId,
      }),
    ]);

    expect(tables.edges[0]?.node.schemaFieldCount).toBeGreaterThan(0);
    expect(rows.totalCount).toBe(0);
  });

  it('attaches table and schema refs without copying row refs', async () => {
    const scenario = await givenReadingScenario(kit(), {
      head: { title: 'Head' },
      draft: { title: 'Draft' },
    });
    await scenario.patchDraftSchema([
      { op: 'add', path: '/properties/category', value: getStringSchema() },
    ]);
    const catalogue = await scenario.readCatalogue();

    const tables = await kit().changes.draftChangedTables({
      ...scenario.branch,
    });
    const tableRefs = tables.edges[0]?.node.refs.map(({ ref }) => ref.value);
    const catalogueRefs = catalogue.entries
      .filter(({ kind }) =>
        ['table', 'schemaField', 'view', 'viewConfiguration'].includes(kind),
      )
      .map(({ ref }) => ref.value);

    expect(tableRefs).toHaveLength(catalogueRefs.length);
    expect(tableRefs?.sort()).toEqual(catalogueRefs.sort());
    expect(catalogue.entries.some(({ kind }) => kind === 'rowField')).toBe(
      true,
    );
    const tableItem = tables.edges[0]?.node;
    if (!tableItem) {
      throw new Error('Expected the edited table in the changed-table list.');
    }
    for (const leaf of tableItem.refs) {
      const selection = await kit().changes.resolveSelection({
        catalogue,
        selection: { include: [{ kind: 'change', ref: leaf.ref }] },
      });
      expect(selection.status).toBe('resolved');
    }
  });
});
