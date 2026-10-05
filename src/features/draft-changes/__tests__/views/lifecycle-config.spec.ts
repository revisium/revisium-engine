import {
  createCandidateViewScenario,
  requireCatalogueEntry,
  requireNeedsEffects,
  requireProjected,
} from './support/candidate-view-scenario';
import {
  addView,
  storedTableViews,
  tableViews,
  withViewsVersion,
} from './support/view-test-data';

describe('candidate views: lifecycle and configuration', () => {
  it('commits a selected newly created view without replacing the existing view', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      const headViews = tableViews();
      await scenario.seedHeadViews(headViews);
      await scenario.updateDraftViews(addView(headViews, 'compact', 'Compact'));
      const entry = await scenario.viewEntry('compact', 'lifecycle');
      expect(entry).toBeDefined();

      const result = requireProjected(
        await scenario.resolveViewChange('commit', 'compact', 'lifecycle'),
      );

      expect(storedTableViews(result.head, 'products')).toEqual(
        addView(headViews, 'compact', 'Compact'),
      );
      expect(storedTableViews(result.draft, 'products')).toEqual(
        addView(headViews, 'compact', 'Compact'),
      );
    } finally {
      await scenario.close();
    }
  });

  it('preserves a selected native stored-view version change', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      const headViews = tableViews();
      await scenario.seedHeadViews(headViews);
      await scenario.updateDraftViews(withViewsVersion(headViews, 2));
      const entry = await scenario.viewConfigurationEntry('version');
      expect(entry).toBeDefined();

      const result = requireProjected(
        await scenario.resolveViewConfigurationChange('commit', 'version'),
      );

      expect(storedTableViews(result.head, 'products')).toEqual(
        withViewsVersion(headViews, 2),
      );
      expect(storedTableViews(result.draft, 'products')).toEqual(
        withViewsVersion(headViews, 2),
      );
    } finally {
      await scenario.close();
    }
  });

  it('requires the exact replacement default when deleting the current default view', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      const headViews = addView(tableViews(), 'compact', 'Compact');
      await scenario.seedHeadViews(headViews);
      await scenario.updateDraftViews({
        ...headViews,
        defaultViewId: 'compact',
        views: headViews.views.filter(({ id }) => id === 'compact'),
      });
      const deletion = await scenario.viewEntry('main', 'lifecycle');
      const replacementDefault =
        await scenario.viewConfigurationEntry('defaultViewId');
      expect(deletion).toBeDefined();
      expect(replacementDefault).toBeDefined();
      const exactDeletion = requireCatalogueEntry(deletion);
      const exactReplacementDefault = requireCatalogueEntry(replacementDefault);

      const result = requireNeedsEffects(
        await scenario.resolveSelection('commit', {
          include: [{ kind: 'change', ref: exactDeletion.ref }],
        }),
      );

      expect(result.requirements).toContainEqual(
        expect.objectContaining({
          role: 'head',
          causeRef: exactDeletion.ref,
          refs: [exactReplacementDefault.ref],
        }),
      );
    } finally {
      await scenario.close();
    }
  });
});
