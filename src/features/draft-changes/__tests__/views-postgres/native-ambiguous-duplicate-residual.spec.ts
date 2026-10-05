import {
  createCandidateViewScenario,
  requireCatalogueEntry,
} from '../views/support/candidate-view-scenario';
import {
  mainView,
  storedTableViews,
  tableViews,
} from '../views/support/view-test-data';

describe('Draft Changes native ambiguous repeated-column residual', () => {
  it('blocks a changed duplicate occurrence whose restored placement has two valid mappings', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      const headViews = {
        ...tableViews(),
        views: [
          {
            ...mainView(tableViews()),
            columns: [
              { field: 'data.price', width: 100 },
              { field: 'data.title', width: 100 },
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

      const removedTitle = requireCatalogueEntry(
        await scenario.schemaEntry('/properties/title'),
      );
      expect(removedTitle.classification).toBe('deleted');
      const prepared = await scenario.prepareSelectedInput('discard', {
        include: [{ kind: 'change', ref: removedTitle.ref }],
      });

      const result = await scenario.resolveSuppliedInput(prepared.query);

      expect(result).toMatchObject({
        status: 'blocked',
        blockers: [
          expect.objectContaining({
            code: 'AMBIGUOUS_VIEW_RESIDUAL',
            viewId: 'main',
            component: 'columns',
          }),
        ],
      });
    } finally {
      await scenario.close();
    }
  });
});
