import {
  createCandidateViewScenario,
  requireProjected,
} from '../views/support/candidate-view-scenario';
import {
  mainView,
  tableViews,
  storedTableViews,
} from '../views/support/view-test-data';

describe('Draft Changes native duplicate-column residual', () => {
  it('commits an unambiguous duplicate-column reduction from the migrated baseline', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      const headViews = {
        ...tableViews(),
        views: [
          {
            ...mainView(tableViews()),
            columns: [
              { field: 'data.price', width: 100 },
              { field: 'data.price', width: 200 },
            ],
          },
        ],
      };
      await scenario.seedHeadViews(headViews);
      const draftViews = {
        ...headViews,
        views: [
          {
            ...mainView(headViews),
            columns: [{ field: 'data.price', width: 200 }],
          },
        ],
      };
      await scenario.updateDraftViews(draftViews);
      const columns = await scenario.viewEntry('main', 'columns');
      expect(columns).toMatchObject({ classification: 'updated' });

      const result = requireProjected(
        await scenario.resolveViewChange('commit', 'main', 'columns'),
      );

      expect(storedTableViews(result.head, 'products')).toEqual(draftViews);
      expect(storedTableViews(result.draft, 'products')).toEqual(draftViews);
    } finally {
      await scenario.close();
    }
  });
});
