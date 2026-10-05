import type { TableViewsData } from 'src/features/views/types';
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

describe('Draft Changes native mutable filter-group logic restoration', () => {
  it('restores a removed nested group while preserving an independently changed sibling logic', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      const headViews = nestedFilterViews();
      await scenario.seedHeadViews(headViews);
      await scenario.removeDraftTitleField();

      const afterRemoval = await scenario.readSnapshot();
      const migratedViews = requireStoredTableViews(
        afterRemoval.draft,
        'products',
      );
      expect(migratedViews.views[0]?.filters).toEqual({
        logic: 'or',
        conditions: [],
        groups: [
          {
            logic: 'and',
            conditions: [{ field: 'data.price', operator: 'gte', value: 5 }],
            groups: [],
          },
        ],
      });
      await scenario.updateDraftViews(withPriceGroupLogic(migratedViews));
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
        logic: 'or',
        conditions: [],
        groups: [
          {
            logic: 'and',
            conditions: [
              { field: 'data.title', operator: 'equals', value: 'Head' },
            ],
            groups: [],
          },
          {
            logic: 'or',
            conditions: [{ field: 'data.price', operator: 'gte', value: 5 }],
            groups: [],
          },
        ],
      });
      expect(await scenario.readSnapshot()).toEqual(afterEdit);
    } finally {
      await scenario.close();
    }
  });
});

function nestedFilterViews(): TableViewsData {
  return {
    ...tableViews(),
    views: [
      {
        ...mainView(tableViews()),
        filters: {
          logic: 'or',
          conditions: [],
          groups: [
            {
              logic: 'and',
              conditions: [
                { field: 'data.title', operator: 'equals', value: 'Head' },
              ],
              groups: [],
            },
            {
              logic: 'and',
              conditions: [{ field: 'data.price', operator: 'gte', value: 5 }],
              groups: [],
            },
          ],
        },
      },
    ],
  };
}

function withPriceGroupLogic(views: TableViewsData): TableViewsData {
  return {
    ...views,
    views: views.views.map((view) => ({
      ...view,
      filters: {
        ...view.filters,
        groups: (view.filters?.groups ?? []).map((group) =>
          group.conditions?.some(({ field }) => field === 'data.price')
            ? { ...group, logic: 'or' }
            : group,
        ),
      },
    })),
  };
}
