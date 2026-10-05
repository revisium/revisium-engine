import {
  createCandidateViewScenario,
  requireProjected,
} from './support/candidate-view-scenario';
import {
  renameMainView,
  storedTableViews,
  tableViews,
} from './support/view-test-data';

describe('candidate views: name residual', () => {
  it('commits only the selected native view name', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      const headViews = tableViews();
      await scenario.seedHeadViews(headViews);
      await scenario.updateDraftViews(renameMainView(headViews, 'Draft name'));
      const entry = await scenario.viewEntry('main', 'name');
      expect(entry).toBeDefined();

      const result = requireProjected(
        await scenario.resolveViewChange('commit', 'main', 'name'),
      );

      expect(storedTableViews(result.head, 'products')).toEqual(
        renameMainView(headViews, 'Draft name'),
      );
      expect(storedTableViews(result.draft, 'products')).toEqual(
        renameMainView(headViews, 'Draft name'),
      );
    } finally {
      await scenario.close();
    }
  });

  it('discards only the selected native view name', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      const headViews = tableViews();
      await scenario.seedHeadViews(headViews);
      await scenario.updateDraftViews(renameMainView(headViews, 'Draft name'));
      const entry = await scenario.viewEntry('main', 'name');
      expect(entry).toBeDefined();

      const result = requireProjected(
        await scenario.resolveViewChange('discard', 'main', 'name'),
      );

      expect(storedTableViews(result.head, 'products')).toEqual(headViews);
      expect(storedTableViews(result.draft, 'products')).toEqual(headViews);
    } finally {
      await scenario.close();
    }
  });
});
