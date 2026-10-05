import {
  createCandidateViewScenario,
  requireProjected,
} from '../views/support/candidate-view-scenario';
import {
  addView,
  storedTableViews,
  tableViews,
} from '../views/support/view-test-data';

describe('Draft Changes native view configuration order', () => {
  it('commits only the selected stored view order and preserves the default', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      const headViews = addView(tableViews(), 'compact', 'Compact');
      await scenario.seedHeadViews(headViews);
      const draftViews = {
        ...headViews,
        views: [...headViews.views].reverse(),
      };
      await scenario.updateDraftViews(draftViews);

      const entry = await scenario.viewConfigurationEntry('order');
      expect(entry).toMatchObject({
        kind: 'viewConfiguration',
        target: { kind: 'viewConfiguration', component: 'order' },
        before: ['main', 'compact'],
        after: ['compact', 'main'],
        selectable: true,
      });
      const source = await scenario.readSnapshot();

      const result = requireProjected(
        await scenario.resolveViewConfigurationChange('commit', 'order'),
      );

      expect(storedTableViews(result.head, 'products')).toEqual({
        ...headViews,
        views: draftViews.views,
      });
      expect(storedTableViews(result.draft, 'products')).toEqual(draftViews);
      expect(storedTableViews(result.head, 'products')?.defaultViewId).toBe(
        'main',
      );
      expect(await scenario.readSnapshot()).toEqual(source);
    } finally {
      await scenario.close();
    }
  });
});
