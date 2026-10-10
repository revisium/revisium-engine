import type { TableViewsData } from 'src/features/views/types';
import { expectUnchangedDraftSnapshot } from '../support/snapshot-assertions';
import {
  createCandidateViewScenario,
  requireCatalogueEntry,
  requireProjected,
} from '../views/support/candidate-view-scenario';
import {
  mainView,
  requireStoredTableViews,
  storedTableViews,
  tableViews,
} from '../views/support/view-test-data';

describe('Draft Changes native mutable filter operator restoration', () => {
  it('restores a removed condition while preserving an independently changed operator', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      const headViews = flatFilterViews();
      await scenario.seedHeadViews(headViews);
      await scenario.removeDraftTitleField();

      const afterRemoval = await scenario.readSnapshot();
      const migratedViews = requireStoredTableViews(
        afterRemoval.draft,
        'products',
      );
      expect(migratedViews.views[0]?.filters?.conditions).toEqual([
        { field: 'data.price', operator: 'gte', value: 5 },
      ]);
      await scenario.updateDraftViews(withPriceOperator(migratedViews, 'lte'));
      const afterEdit = await scenario.readSnapshot();
      const titleRemoval = requireCatalogueEntry(
        await scenario.schemaEntry('/properties/title'),
      );

      const result = requireProjected(
        await scenario.resolveSelection('discard', {
          include: [{ kind: 'change', ref: titleRemoval.ref }],
        }),
      );

      expect(storedTableViews(result.head, 'products')).toEqual(headViews);
      expect(
        storedTableViews(result.draft, 'products')?.views[0]?.filters,
      ).toEqual({
        logic: 'and',
        conditions: [
          { field: 'data.title', operator: 'equals', value: 'Head' },
          { field: 'data.price', operator: 'lte', value: 8 },
        ],
        groups: [],
      });
      expectUnchangedDraftSnapshot(afterEdit, await scenario.readSnapshot());
    } finally {
      await scenario.close();
    }
  });
});

function flatFilterViews(): TableViewsData {
  return {
    ...tableViews(),
    views: [
      {
        ...mainView(tableViews()),
        filters: {
          logic: 'and',
          conditions: [
            { field: 'data.title', operator: 'equals', value: 'Head' },
            { field: 'data.price', operator: 'gte', value: 5 },
          ],
          groups: [],
        },
      },
    ],
  };
}

function withPriceOperator(
  views: TableViewsData,
  operator: 'gte' | 'lte',
): TableViewsData {
  return {
    ...views,
    views: views.views.map((view) => ({
      ...view,
      filters: {
        ...view.filters,
        conditions: (view.filters?.conditions ?? []).map((condition) =>
          condition.field === 'data.price'
            ? { ...condition, operator, value: 8 }
            : condition,
        ),
      },
    })),
  };
}
