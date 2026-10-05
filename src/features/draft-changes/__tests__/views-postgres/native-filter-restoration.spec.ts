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
import type { TableViewsData } from 'src/features/views/types';

function filterViewsWithPriceValue(
  views: TableViewsData,
  value: number,
): TableViewsData {
  return {
    ...views,
    views: views.views.map((view) => ({
      ...view,
      filters: {
        ...view.filters,
        conditions: (view.filters?.conditions ?? []).map((condition) =>
          condition.field === 'data.price'
            ? { ...condition, value }
            : condition,
        ),
      },
    })),
  };
}

describe('Draft Changes native filter restoration', () => {
  it('restores a removed condition while preserving an independent sibling edit', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      const headViews = withFlatFilters();
      await scenario.seedHeadViews(headViews);
      await scenario.removeDraftTitleField();
      const migratedDraft = await scenario.readSnapshot();
      const migratedViews = requireStoredTableViews(
        migratedDraft.draft,
        'products',
      );
      expect(migratedViews?.views[0]?.filters?.conditions).toEqual([
        { field: 'data.price', operator: 'gte', value: 5 },
      ]);
      await scenario.updateDraftViews(
        filterViewsWithPriceValue(migratedViews, 8),
      );
      const removal = requireCatalogueEntry(
        await scenario.schemaEntry('/properties/title'),
      );

      const result = requireProjected(
        await scenario.resolveSelection('discard', {
          include: [{ kind: 'change', ref: removal.ref }],
        }),
      );

      expect(
        storedTableViews(result.draft, 'products')?.views[0]?.filters,
      ).toEqual({
        logic: 'and',
        conditions: [
          { field: 'data.title', operator: 'equals', value: 'Head' },
          { field: 'data.price', operator: 'gte', value: 8 },
        ],
        groups: [],
      });
    } finally {
      await scenario.close();
    }
  });

  it('restores a removed nested group without flattening a changed sibling group', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      const headViews = withNestedFilters();
      await scenario.seedHeadViews(headViews);
      await scenario.removeDraftTitleField();
      const migrated = await scenario.readSnapshot();
      const migratedViews = requireStoredTableViews(migrated.draft, 'products');
      expect(migratedViews?.views[0]?.filters?.groups).toHaveLength(1);
      await scenario.updateDraftViews(updateNestedPriceValue(migratedViews, 8));
      const removal = requireCatalogueEntry(
        await scenario.schemaEntry('/properties/title'),
      );

      const result = requireProjected(
        await scenario.resolveSelection('discard', {
          include: [{ kind: 'change', ref: removal.ref }],
        }),
      );

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
            logic: 'and',
            conditions: [{ field: 'data.price', operator: 'gte', value: 8 }],
            groups: [],
          },
        ],
      });
    } finally {
      await scenario.close();
    }
  });
});

function withFlatFilters(): TableViewsData {
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

function withNestedFilters(): TableViewsData {
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

function updateNestedPriceValue(
  views: TableViewsData,
  value: number,
): TableViewsData {
  return {
    ...views,
    views: views.views.map((view) => ({
      ...view,
      filters: {
        ...view.filters,
        groups: (view.filters?.groups ?? []).map((group) => ({
          ...group,
          conditions: (group.conditions ?? []).map((condition) =>
            condition.field === 'data.price'
              ? { ...condition, value }
              : condition,
          ),
        })),
      },
    })),
  };
}
