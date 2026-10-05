import {
  createCandidateViewScenario,
  requireCatalogueEntry,
  requireProjected,
} from './support/candidate-view-scenario';
import {
  renameMainView,
  storedTableViews,
  tableViews,
} from './support/view-test-data';

describe('candidate views: exact selection', () => {
  it('keeps an excluded view edit in Draft without importing it into Head', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      const headViews = tableViews();
      const draftViews = renameMainView(headViews, 'Draft name');
      await scenario.seedHeadViews(headViews);
      await scenario.updateDraftViews(draftViews);
      const nameEntry = await scenario.viewEntry('main', 'name');
      expect(nameEntry).toBeDefined();
      const exactNameEntry = requireCatalogueEntry(nameEntry);

      const result = requireProjected(
        await scenario.resolveSelection('commit', {
          include: [],
          exclude: [{ kind: 'change', ref: exactNameEntry.ref }],
        }),
      );

      expect(storedTableViews(result.head, 'products')).toEqual(headViews);
      expect(storedTableViews(result.draft, 'products')).toEqual(draftViews);
    } finally {
      await scenario.close();
    }
  });
});
