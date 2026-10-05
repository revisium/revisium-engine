import {
  createCandidateViewScenario,
  requireProjected,
} from './support/candidate-view-scenario';
import { storedTableViews } from './support/view-test-data';

describe('candidate views: stored presence', () => {
  it('keeps an absent stored views row absent on no-op candidates', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      const snapshot = await scenario.readSnapshot();
      expect(storedTableViews(snapshot.head, 'products')).toBeUndefined();
      expect(storedTableViews(snapshot.draft, 'products')).toBeUndefined();

      const result = requireProjected(await scenario.resolveNoOp());

      expect(storedTableViews(result.head, 'products')).toBeUndefined();
      expect(storedTableViews(result.draft, 'products')).toBeUndefined();
      expect(await scenario.readSnapshot()).toEqual(snapshot);
    } finally {
      await scenario.close();
    }
  });

  it('preserves native version and omitted versus null optional values', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      const views = {
        version: 2,
        defaultViewId: 'main',
        views: [{ id: 'main', name: 'Main', columns: null }],
      };
      const expected = structuredClone(views);
      await scenario.seedHeadViews(views);
      await scenario.renameDraftPriceField();
      const schemaEntry = await scenario.schemaEntry('/properties/cost');
      expect(schemaEntry).toBeDefined();

      const result = requireProjected(
        await scenario.resolveSchemaField('commit', '/properties/cost'),
      );

      expect(storedTableViews(result.head, 'products')).toStrictEqual(expected);
      expect(storedTableViews(result.draft, 'products')).toStrictEqual(
        expected,
      );
    } finally {
      await scenario.close();
    }
  });
});
