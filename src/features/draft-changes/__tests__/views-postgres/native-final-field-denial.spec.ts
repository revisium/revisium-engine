import { getStringSchema } from '@revisium/schema-toolkit/mocks';
import {
  createCandidateViewScenario,
  requireCatalogueEntry,
} from '../views/support/candidate-view-scenario';
import { tableViews } from '../views/support/view-test-data';

describe('Draft Changes native final view field validation', () => {
  it('does not import an excluded schema ADD needed by a selected view columns edit', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      const headViews = tableViews();
      await scenario.seedHeadViews(headViews);
      await scenario.updateDraftSchema([
        { op: 'add', path: '/properties/extra', value: getStringSchema() },
      ]);
      await scenario.updateDraftViews({
        ...headViews,
        views: headViews.views.map((view) => ({
          ...view,
          columns: [
            ...(view.columns ?? []),
            { field: 'data.extra', width: 100 },
          ],
        })),
      });

      const columnsEntry = await scenario.viewEntry('main', 'columns');
      expect(columnsEntry).toBeDefined();
      const columns = requireCatalogueEntry(columnsEntry);
      const schemaAddition = requireCatalogueEntry(
        await scenario.schemaEntry('/properties/extra'),
      );
      expect(schemaAddition.classification).toBe('created');
      const prepared = await scenario.prepareSelectedInput('commit', {
        include: [{ kind: 'change', ref: columns.ref }],
        exclude: [{ kind: 'change', ref: schemaAddition.ref }],
      });
      expect(prepared.query.selection.selected.map(({ ref }) => ref)).toEqual([
        columns.ref,
      ]);
      expect(
        prepared.query.selection.excluded.map(({ ref }) => ref.value),
      ).toContain(schemaAddition.ref.value);

      const result = await scenario.resolveSuppliedInput(prepared.query);

      expect(result).toMatchObject({
        status: 'blocked',
        blockers: [
          expect.objectContaining({
            code: 'INVALID_VIEW_DATA',
            component: 'columns',
            path: expect.stringContaining('data.extra'),
          }),
        ],
      });
    } finally {
      await scenario.close();
    }
  });
});
