import {
  getNumberSchema,
  getObjectSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import {
  createCandidateViewScenario,
  requireCatalogueEntry,
  requireProjected,
} from '../views/support/candidate-view-scenario';
import { storedTableViews, tableViews } from '../views/support/view-test-data';
import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';

describe('Draft Changes native table identity for views', () => {
  it('keeps each stored views document with its stable table identity through a public-ID swap', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      const schema = getObjectSchema({
        price: getNumberSchema(),
        title: getStringSchema(),
      });
      await scenario.createDraftTable('secondary-products', schema, [
        { rowId: 'secondary-product', data: { price: 20, title: 'Secondary' } },
      ]);
      const primaryViews = tableViews('Primary');
      const secondaryViews = tableViews('Secondary');
      await scenario.updateDraftViews(primaryViews);
      await scenario.updateDraftViewsForTable(
        'secondary-products',
        secondaryViews,
      );
      await scenario.commitDraft();

      const published = await scenario.readSnapshot();
      const primaryCreatedId = requireTable(
        published.head,
        'products',
      ).createdId;
      const secondaryCreatedId = requireTable(
        published.head,
        'secondary-products',
      ).createdId;

      await scenario.renameDraftTable('products', 'stage9-swap-temp');
      await scenario.renameDraftTable('secondary-products', 'products');
      await scenario.renameDraftTable('stage9-swap-temp', 'secondary-products');

      const primaryRename = requireCatalogueEntry(
        await scenario.tableEntry(primaryCreatedId),
      );
      const secondaryRename = requireCatalogueEntry(
        await scenario.tableEntry(secondaryCreatedId),
      );
      expect(primaryRename.classification).toBe('renamed');
      expect(secondaryRename.classification).toBe('renamed');
      const prepared = await scenario.prepareSelectedInput('commit', {
        include: [primaryRename, secondaryRename].map(({ ref }) => ({
          kind: 'change' as const,
          ref,
        })),
      });
      expect(
        prepared.query.selection.selected.map(({ ref }) => ref.value).sort(),
      ).toEqual([primaryRename.ref.value, secondaryRename.ref.value].sort());

      const result = requireProjected(
        await scenario.resolveSuppliedInput(prepared.query),
      );

      expect(requireTable(result.head, primaryCreatedId).id).toBe(
        'secondary-products',
      );
      expect(requireTable(result.head, secondaryCreatedId).id).toBe('products');
      expect(viewsForIdentity(result.head, primaryCreatedId)).toEqual(
        primaryViews,
      );
      expect(viewsForIdentity(result.head, secondaryCreatedId)).toEqual(
        secondaryViews,
      );
      expect(viewsForIdentity(result.draft, primaryCreatedId)).toEqual(
        primaryViews,
      );
      expect(viewsForIdentity(result.draft, secondaryCreatedId)).toEqual(
        secondaryViews,
      );
    } finally {
      await scenario.close();
    }
  });

  it('uses the exact original rename ref when a new table reuses the old public ID', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      const original = await scenario.readSnapshot();
      const oldCreatedId = requireTable(original.head, 'products').createdId;
      const oldViews = tableViews('Original products');
      await scenario.seedHeadViews(oldViews);
      await scenario.renameDraftTable('products', 'archived-products');
      await scenario.createDraftTable(
        'products',
        getObjectSchema({ price: getNumberSchema(), title: getStringSchema() }),
        [{ rowId: 'new-product', data: { price: 50, title: 'New' } }],
      );
      const newViews = tableViews('New products');
      await scenario.updateDraftViewsForTable('products', newViews);

      const current = await scenario.readSnapshot();
      const newCreatedId = requireTable(current.draft, 'products').createdId;
      expect(newCreatedId).not.toBe(oldCreatedId);
      const originalRename = requireCatalogueEntry(
        await scenario.tableEntry(oldCreatedId),
      );
      expect(originalRename.target).toMatchObject({
        kind: 'table',
        tableCreatedId: oldCreatedId,
        tableId: 'archived-products',
      });

      const prepared = await scenario.prepareSelectedInput('commit', {
        include: [{ kind: 'change', ref: originalRename.ref }],
      });
      expect(prepared.query.selection.selected.map(({ ref }) => ref)).toEqual([
        originalRename.ref,
      ]);
      const result = requireProjected(
        await scenario.resolveSuppliedInput(prepared.query),
      );

      expect(requireTable(result.head, oldCreatedId).id).toBe(
        'archived-products',
      );
      expect(
        result.head.tables.some(({ createdId }) => createdId === newCreatedId),
      ).toBe(false);
      expect(requireTable(result.draft, newCreatedId).id).toBe('products');
      expect(viewsForIdentity(result.head, oldCreatedId)).toEqual(oldViews);
      expect(viewsForIdentity(result.draft, oldCreatedId)).toEqual(oldViews);
      expect(viewsForIdentity(result.draft, newCreatedId)).toEqual(newViews);
    } finally {
      await scenario.close();
    }
  });
});

function requireTable(state: DraftRevisionState, createdIdOrPublicId: string) {
  const table = state.tables.find(
    ({ createdId, id, system }) =>
      !system &&
      (createdId === createdIdOrPublicId || id === createdIdOrPublicId),
  );
  if (!table) {
    throw new Error(`Expected user table '${createdIdOrPublicId}'.`);
  }
  return table;
}

function viewsForIdentity(state: DraftRevisionState, tableCreatedId: string) {
  const table = requireTable(state, tableCreatedId);
  return storedTableViews(state, table.id);
}
