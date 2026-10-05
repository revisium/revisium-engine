import {
  createCandidateViewScenario,
  requireCatalogueEntry,
} from '../views/support/candidate-view-scenario';
import {
  addView,
  renameMainView,
  tableViews,
} from '../views/support/view-test-data';

describe('Draft Changes native view selection closure', () => {
  it('includes a table’s exact view edit for rows:none without importing row edits', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      const headViews = addView(tableViews(), 'compact', 'Compact');
      await scenario.seedHeadViews(headViews);
      const renamedViews = renameMainView(headViews, 'Draft name');
      const draftViews = {
        ...renamedViews,
        views: [...renamedViews.views].reverse(),
      };
      await scenario.updateDraftViews(draftViews);
      await scenario.updateDraftRow('products', 'product', {
        price: 20,
        title: 'Draft row',
      });

      const nameEntry = await scenario.viewEntry('main', 'name');
      expect(nameEntry).toBeDefined();
      const name = requireCatalogueEntry(nameEntry);
      const orderEntry = await scenario.viewConfigurationEntry('order');
      expect(orderEntry).toBeDefined();
      const order = requireCatalogueEntry(orderEntry);
      const snapshot = await scenario.readSnapshot();
      const productTable = snapshot.head.tables.find(
        ({ id }) => id === 'products',
      );
      const productRow = productTable?.rows.find(({ id }) => id === 'product');
      if (!productTable || !productRow) {
        throw new Error('Expected native products table and row.');
      }
      const catalogue = await scenario.catalogue();
      const rowRef = catalogue.entries.find(
        ({ target }) =>
          target.kind === 'rowField' &&
          target.tableCreatedId === productTable.createdId &&
          target.rowCreatedId === productRow.createdId &&
          target.path === '/price',
      );
      expect(rowRef).toBeDefined();

      const included = await scenario.resolveNativeSelection({
        include: [{ kind: 'table', tableId: 'products', rows: 'none' }],
      });
      expect(included).toMatchObject({ status: 'resolved' });
      if (included.status !== 'resolved') {
        throw new Error('Expected native table selection.');
      }
      const selectedRefValues = included.selected.map(({ ref }) => ref.value);
      expect(selectedRefValues).toContain(name.ref.value);
      expect(selectedRefValues).toContain(order.ref.value);
      expect(selectedRefValues).not.toContain(rowRef?.ref.value);

      const denied = await scenario.resolveNativeSelection({
        include: [{ kind: 'all' }],
        exclude: [{ kind: 'table', tableId: 'products', rows: 'none' }],
      });
      expect(denied).toMatchObject({
        status: 'resolved',
        deniedTargets: [
          expect.objectContaining({
            kind: 'table',
            facets: expect.arrayContaining(['views']),
          }),
        ],
      });
    } finally {
      await scenario.close();
    }
  });
});
