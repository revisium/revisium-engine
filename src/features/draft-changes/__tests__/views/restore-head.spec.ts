import {
  createCandidateViewScenario,
  requireProjected,
} from './support/candidate-view-scenario';
import {
  renameMainView,
  schemaHistoryMetadata,
  storedTableViews,
  tableViews,
} from './support/view-test-data';

describe('candidate views: restore Head', () => {
  it('restores stored Head views without reading invalid Draft schema history', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      const headViews = tableViews();
      await scenario.seedHeadViews(headViews);
      await scenario.updateDraftViews(renameMainView(headViews, 'Draft name'));
      const beforeInvalidHistory = await scenario.readSnapshot();
      await scenario.tamperDraftSchemaHistory();
      const snapshot = await scenario.readSnapshot();
      expect(snapshot.head).toEqual(beforeInvalidHistory.head);
      expect(schemaHistoryMetadata(snapshot.draft, 'products')).toBe(
        'invalid-history',
      );

      const result = requireProjected(await scenario.restoreHead());

      expect(storedTableViews(result.head, 'products')).toEqual(headViews);
      expect(storedTableViews(result.draft, 'products')).toEqual(headViews);
      expect(await scenario.readSnapshot()).toEqual(snapshot);
    } finally {
      await scenario.close();
    }
  });
});
