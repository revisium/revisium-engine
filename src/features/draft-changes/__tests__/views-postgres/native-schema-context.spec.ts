import {
  createCandidateViewScenario,
  requireCatalogueEntry,
  requireProjected,
} from '../views/support/candidate-view-scenario';
import {
  draftViewsAfterPriceRename,
  storedTableViews,
  tableViews,
} from '../views/support/view-test-data';

describe('Draft Changes native schema context', () => {
  it('uses schema context for a selected rename while an excluded name edit stays in Draft', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      const headViews = tableViews();
      await scenario.seedHeadViews(headViews);
      await scenario.renameDraftPriceField();
      await scenario.updateDraftViews(draftViewsAfterPriceRename());

      const schemaRename = requireCatalogueEntry(
        await scenario.schemaEntry('/properties/cost'),
      );
      const siblingNameEntry = await scenario.viewEntry('main', 'name');
      expect(siblingNameEntry).toBeDefined();
      const siblingName = requireCatalogueEntry(siblingNameEntry);
      const source = await scenario.readSnapshot();
      expect(schemaRename.target).toMatchObject({
        kind: 'schemaField',
        path: '/properties/cost',
      });
      expect(siblingName.target).toMatchObject({
        kind: 'view',
        viewId: 'main',
        component: 'name',
      });

      const result = requireProjected(
        await scenario.resolveSelection('commit', {
          include: [{ kind: 'change', ref: schemaRename.ref }],
          exclude: [{ kind: 'change', ref: siblingName.ref }],
        }),
      );

      expect(storedTableViews(result.head, 'products')?.views[0]).toMatchObject(
        {
          name: 'Default',
          columns: [
            { field: 'data.cost', width: 100 },
            { field: 'data.title', width: 100 },
          ],
        },
      );
      expect(storedTableViews(result.draft, 'products')).toEqual(
        draftViewsAfterPriceRename(),
      );
      expect(await scenario.readSnapshot()).toEqual(source);
    } finally {
      await scenario.close();
    }
  });
});
