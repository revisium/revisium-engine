import {
  createCandidateViewScenario,
  requireCatalogueEntry,
} from '../views/support/candidate-view-scenario';
import { addView, tableViews } from '../views/support/view-test-data';
import { expectUnchangedDraftSnapshot } from '../support/snapshot-assertions';

describe('Draft Changes native reverse default-view dependency', () => {
  it('requires the exact deleted-view ref when discarding only its default change', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      const headViews = addView(tableViews(), 'compact', 'Compact');
      await scenario.seedHeadViews(headViews);
      const draftViews = {
        ...headViews,
        defaultViewId: 'compact',
        views: headViews.views.filter(({ id }) => id !== 'main'),
      };
      await scenario.updateDraftViews(draftViews);
      const afterEdit = await scenario.readSnapshot();

      const defaultChange = requireCatalogueEntry(
        await scenario.viewConfigurationEntry('defaultViewId'),
      );
      expect(defaultChange.classification).toBe('updated');
      const deletedMain = requireCatalogueEntry(
        await scenario.viewEntry('main', 'lifecycle'),
      );
      expect(deletedMain.classification).toBe('deleted');

      const result = await scenario.resolveSelectionWithBlockers('discard', {
        include: [{ kind: 'change', ref: defaultChange.ref }],
      });

      expect(result).toMatchObject({
        status: 'needsEffects',
        requirements: [
          expect.objectContaining({
            role: 'draft',
            causeRef: defaultChange.ref,
            refs: [deletedMain.ref],
          }),
        ],
      });
      expectUnchangedDraftSnapshot(afterEdit, await scenario.readSnapshot());
    } finally {
      await scenario.close();
    }
  });
});
