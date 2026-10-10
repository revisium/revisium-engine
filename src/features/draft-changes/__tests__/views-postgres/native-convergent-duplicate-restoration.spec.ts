import {
  createCandidateViewScenario,
  requireCatalogueEntry,
  requireProjected,
} from '../views/support/candidate-view-scenario';
import {
  mainView,
  storedTableViews,
  tableViews,
} from '../views/support/view-test-data';
import { expectUnchangedDraftSnapshot } from '../support/snapshot-assertions';

describe('Draft Changes native convergent duplicate restoration', () => {
  it('restores a changed adjacent duplicate when both placements converge', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      const headViews = {
        ...tableViews(),
        views: [
          {
            ...mainView(tableViews()),
            columns: [
              { field: 'data.title', width: 100 },
              { field: 'data.price', width: 100 },
              { field: 'data.price', width: 100 },
            ],
          },
        ],
      };
      await scenario.seedHeadViews(headViews);
      await scenario.removeDraftTitleField();

      const afterRemoval = await scenario.readSnapshot();
      expect(
        storedTableViews(afterRemoval.draft, 'products')?.views[0]?.columns,
      ).toEqual([
        { field: 'data.price', width: 100 },
        { field: 'data.price', width: 100 },
      ]);
      await scenario.updateDraftViews({
        ...tableViews(),
        views: [
          {
            ...mainView(tableViews()),
            columns: [{ field: 'data.price', width: 240 }],
          },
        ],
      });

      const afterEdit = await scenario.readSnapshot();
      const removedTitle = requireCatalogueEntry(
        await scenario.schemaEntry('/properties/title'),
      );
      expect(removedTitle.classification).toBe('deleted');
      const prepared = await scenario.prepareSelectedInput('discard', {
        include: [{ kind: 'change', ref: removedTitle.ref }],
      });
      const result = requireProjected(
        await scenario.resolveSuppliedInput(prepared.query),
      );

      expect(storedTableViews(result.head, 'products')).toEqual(headViews);
      expect(
        storedTableViews(result.draft, 'products')?.views[0]?.columns,
      ).toEqual([
        { field: 'data.title', width: 100 },
        { field: 'data.price', width: 240 },
      ]);
      expectUnchangedDraftSnapshot(afterEdit, await scenario.readSnapshot());
    } finally {
      await scenario.close();
    }
  });
});
