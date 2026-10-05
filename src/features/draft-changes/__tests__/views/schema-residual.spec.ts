import {
  createCandidateViewScenario,
  requireProjected,
} from './support/candidate-view-scenario';
import {
  draftViewsAfterDiscardedPriceRename,
  draftViewsAfterPriceRename,
  mainView,
  requireStoredTableViews,
  storedTableViews,
  tableViews,
} from './support/view-test-data';

describe('candidate views: schema residuals', () => {
  it('projects a selected schema rename while retaining independent Draft view edits', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      const headViews = tableViews();
      await scenario.seedHeadViews(headViews);
      await scenario.renameDraftPriceField();
      await scenario.updateDraftViews(draftViewsAfterPriceRename());
      const schemaEntry = await scenario.schemaEntry('/properties/cost');
      expect(schemaEntry).toBeDefined();
      const result = requireProjected(
        await scenario.resolveSchemaField('commit', '/properties/cost'),
      );

      expect(storedTableViews(result.head, 'products')).toEqual({
        ...headViews,
        views: [
          {
            ...mainView(headViews),
            columns: [
              { field: 'data.cost', width: 100 },
              { field: 'data.title', width: 100 },
            ],
          },
        ],
      });
      expect(storedTableViews(result.draft, 'products')).toEqual(
        draftViewsAfterPriceRename(),
      );
    } finally {
      await scenario.close();
    }
  });

  it('restores a removed schema column without losing a surviving Draft width edit', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      const headViews = tableViews();
      await scenario.seedHeadViews(headViews);
      await scenario.removeDraftTitleField();
      await scenario.updateDraftViews({
        ...headViews,
        views: [
          {
            ...mainView(headViews),
            columns: [{ field: 'data.price', width: 240 }],
          },
        ],
      });
      const schemaEntry = await scenario.schemaEntry('/properties/title');
      expect(schemaEntry).toBeDefined();

      const result = requireProjected(
        await scenario.resolveSchemaField('discard', '/properties/title'),
      );

      expect(storedTableViews(result.head, 'products')).toEqual(headViews);
      expect(storedTableViews(result.draft, 'products')).toEqual({
        ...headViews,
        views: [
          {
            ...mainView(headViews),
            columns: [
              { field: 'data.price', width: 240 },
              { field: 'data.title', width: 100 },
            ],
          },
        ],
      });
    } finally {
      await scenario.close();
    }
  });

  it('discards a field rename while mapping independent Draft view edits back to the Head field', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      const headViews = tableViews();
      await scenario.seedHeadViews(headViews);
      await scenario.renameDraftPriceField();
      await scenario.updateDraftViews(draftViewsAfterPriceRename());
      const schemaEntry = await scenario.schemaEntry('/properties/cost');
      expect(schemaEntry).toBeDefined();

      const result = requireProjected(
        await scenario.resolveSchemaField('discard', '/properties/cost'),
      );

      expect(storedTableViews(result.head, 'products')).toEqual(headViews);
      expect(storedTableViews(result.draft, 'products')).toEqual(
        draftViewsAfterDiscardedPriceRename(),
      );
    } finally {
      await scenario.close();
    }
  });

  it('keeps valid repeated column occurrences during automatic schema migration', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      const baseViews = tableViews();
      const headViews = {
        ...baseViews,
        views: [
          {
            ...mainView(baseViews),
            columns: [
              { field: 'data.price', width: 100 },
              { field: 'data.price', width: 240 },
            ],
          },
        ],
      };
      await scenario.seedHeadViews(headViews);
      await scenario.renameDraftPriceField();
      await scenario.updateDraftViews({
        ...headViews,
        views: [
          {
            ...mainView(headViews),
            columns: [
              { field: 'data.cost', width: 100 },
              { field: 'data.cost', width: 240 },
            ],
          },
        ],
      });
      const schemaEntry = await scenario.schemaEntry('/properties/cost');
      expect(schemaEntry).toBeDefined();

      const result = requireProjected(
        await scenario.resolveSchemaField('commit', '/properties/cost'),
      );

      expect(storedTableViews(result.head, 'products')).toEqual(
        storedTableViews(result.draft, 'products'),
      );
      expect(
        mainView(requireStoredTableViews(result.head, 'products')).columns,
      ).toEqual([
        { field: 'data.cost', width: 100 },
        { field: 'data.cost', width: 240 },
      ]);
    } finally {
      await scenario.close();
    }
  });
});
