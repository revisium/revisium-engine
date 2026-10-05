import {
  getObjectSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
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

describe('Draft Changes native deletion LAST context', () => {
  it('migrates Head views from the required FK removal while retaining independent Draft edits', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      await scenario.createDraftTable(
        'targets',
        getObjectSchema({ code: getStringSchema() }),
        [{ rowId: 'target-a', data: { code: 'A' } }],
      );
      await scenario.removeDraftRow('products', 'product');
      await scenario.updateDraftSchema([
        {
          op: 'add',
          path: '/properties/link',
          value: {
            ...getStringSchema(),
            foreignKey: 'targets',
            description: 'Head link',
          },
        },
      ]);
      await scenario.createDraftRow('products', 'product', {
        price: 10,
        title: 'Head',
        link: 'target-a',
      });
      const headViews: TableViewsData = {
        ...tableViews(),
        views: [
          {
            ...mainView(tableViews()),
            description: 'Head description',
            columns: [
              { field: 'data.link', width: 100 },
              { field: 'data.title', width: 120 },
            ],
          },
        ],
      };
      await scenario.updateDraftViews(headViews);
      await scenario.commitDraft();

      const head = await scenario.readSnapshot();
      const products = head.head.tables.find(({ id }) => id === 'products');
      const targets = head.head.tables.find(({ id }) => id === 'targets');
      const target = targets?.rows.find(({ id }) => id === 'target-a');
      if (!products || !targets || !target) {
        throw new Error(
          'Expected native Head source and FK target identities.',
        );
      }

      await scenario.updateDraftSchema([
        { op: 'remove', path: '/properties/link' },
      ]);
      await scenario.updateDraftSchema([
        {
          op: 'replace',
          path: '/properties/title',
          value: { ...getStringSchema(), description: 'Draft title' },
        },
      ]);
      const afterSchemaChanges = await scenario.readSnapshot();
      const migratedViews = requireStoredTableViews(
        afterSchemaChanges.draft,
        'products',
      );
      expect(migratedViews?.views[0]?.columns).toEqual([
        { field: 'data.title', width: 120 },
      ]);
      const draftViews: TableViewsData = {
        ...migratedViews,
        views: migratedViews.views.map((view) => ({
          ...view,
          name: 'Draft name',
          description: 'Draft description',
          columns: [{ field: 'data.title', width: 180 }],
        })),
      };
      await scenario.updateDraftViews(draftViews);
      await scenario.removeDraftRow('targets', 'target-a');

      const schemaRemoval = requireCatalogueEntry(
        await scenario.schemaEntry('/properties/link', products.createdId),
      );
      const independentDescription = requireCatalogueEntry(
        await scenario.schemaEntry('/properties/title', products.createdId),
      );
      const targetDeletion = requireCatalogueEntry(
        await scenario.rowEntry(targets.createdId, target.createdId),
      );
      expect(schemaRemoval.classification).toBe('deleted');
      expect(targetDeletion.classification).toBe('deleted');
      expect(schemaRemoval.effectRefs).toHaveLength(1);

      const prepared = await scenario.prepareSelectedInput('commit', {
        include: [{ kind: 'change', ref: targetDeletion.ref }],
      });
      expect(prepared.query.selection.selected.map(({ ref }) => ref)).toEqual([
        targetDeletion.ref,
      ]);
      expect(prepared.required).toContainEqual(
        expect.objectContaining({
          role: 'head',
          kind: 'schemaEffects',
          causeRef: targetDeletion.ref,
          tableCreatedId: products.createdId,
          effects: schemaRemoval.effectRefs,
        }),
      );
      const initialBinding = prepared.initialSchemaProjectionBindings.find(
        ({ tableCreatedId }) => tableCreatedId === products.createdId,
      );
      expect(initialBinding?.selectedEffects ?? []).not.toContainEqual(
        schemaRemoval.effectRefs?.[0],
      );
      const finalBinding = prepared.query.schemaProjectionBindings.find(
        ({ tableCreatedId }) => tableCreatedId === products.createdId,
      );
      expect(finalBinding?.selectedEffects).toEqual(schemaRemoval.effectRefs);
      expect(initialBinding?.selectedEffects ?? []).not.toEqual(
        finalBinding?.selectedEffects,
      );
      expect(finalBinding?.selectedEffects).not.toEqual(
        independentDescription.effectRefs,
      );

      const result = requireProjected(
        await scenario.resolveSuppliedInput(prepared.query),
      );
      expect(storedTableViews(result.head, 'products')?.views[0]).toMatchObject(
        {
          description: 'Head description',
          columns: [{ field: 'data.title', width: 120 }],
        },
      );
      expect(storedTableViews(result.draft, 'products')).toEqual(draftViews);
    } finally {
      await scenario.close();
    }
  });
});
