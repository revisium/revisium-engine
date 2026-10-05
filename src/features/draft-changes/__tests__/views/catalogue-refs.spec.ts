import { createCandidateViewScenario } from './support/candidate-view-scenario';
import { renameMainView, tableViews } from './support/view-test-data';

describe('candidate views: catalogue refs', () => {
  it('exposes a native stored view name edit as its own opaque change target', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      const headViews = tableViews();
      await scenario.seedHeadViews(headViews);
      await scenario.updateDraftViews(renameMainView(headViews, 'Draft name'));

      const entry = await scenario.viewEntry('main', 'name');

      expect(entry).toMatchObject({
        kind: 'view',
        target: {
          kind: 'view',
          tableId: 'products',
          viewId: 'main',
          component: 'name',
        },
        before: 'Default',
        after: 'Draft name',
        beforeExists: true,
        afterExists: true,
        selectable: true,
      });
    } finally {
      await scenario.close();
    }
  });
});
