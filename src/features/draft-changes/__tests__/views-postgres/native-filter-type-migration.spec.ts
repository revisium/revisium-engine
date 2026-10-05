import { getStringSchema } from '@revisium/schema-toolkit/mocks';
import { expectUnchangedDraftSnapshot } from '../support/snapshot-assertions';
import {
  createCandidateViewScenario,
  requireProjected,
} from '../views/support/candidate-view-scenario';
import {
  mainView,
  requireStoredTableViews,
  storedTableViews,
  tableViews,
} from '../views/support/view-test-data';

describe('Draft Changes native filter type migration', () => {
  it('prunes only the type-invalid condition and preserves nested filter logic', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      const base = tableViews();
      const headViews = {
        ...base,
        views: [
          {
            ...mainView(base),
            filters: {
              logic: 'or' as const,
              conditions: [{ field: 'data.price', operator: 'gte', value: 5 }],
              groups: [
                {
                  logic: 'and' as const,
                  conditions: [
                    { field: 'data.title', operator: 'equals', value: 'Head' },
                  ],
                  groups: [],
                },
              ],
            },
          },
        ],
      };
      await scenario.seedHeadViews(headViews);
      await scenario.updateDraftSchema([
        { op: 'replace', path: '/properties/price', value: getStringSchema() },
      ]);
      const afterTypeReplacement = await scenario.readSnapshot();
      const migratedDraftViews = requireStoredTableViews(
        afterTypeReplacement.draft,
        'products',
      );
      const draftViews = {
        ...migratedDraftViews,
        views: migratedDraftViews.views.map((view) => ({
          ...view,
          name: 'Draft name',
        })),
      };
      await scenario.updateDraftViews(draftViews);
      const source = await scenario.readSnapshot();

      const entry = await scenario.schemaEntry('/properties/price');
      expect(entry).toBeDefined();
      const result = requireProjected(
        await scenario.resolveSchemaField('commit', '/properties/price'),
      );

      expect(
        storedTableViews(result.head, 'products')?.views[0]?.filters,
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
        ],
      });
      expect(storedTableViews(result.draft, 'products')).toMatchObject({
        views: [{ id: 'main', name: 'Draft name' }],
      });
      expectUnchangedDraftSnapshot(source, await scenario.readSnapshot());
    } finally {
      await scenario.close();
    }
  });
});
