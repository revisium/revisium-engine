import {
  createDraftTestKit,
  type DraftTestKit,
} from 'src/__tests__/kit/create-draft-test-kit';
import { serializationFailure } from 'src/features/draft-revision/services/__tests__/support/revision-lookup-test-kit';
import {
  failTableLookupOnceWith,
  failViewsRowLookupOnceWith,
} from 'src/features/share/__tests__/support/lookup-failures';
import {
  givenDraftWithViews,
  readViews,
} from 'src/features/views/__tests__/support/views-update-scenario';
import type { TableViewsData } from 'src/features/views/types';
import {
  givenTableReferencingRow,
  givenTableWithRows,
  type ReferringTable,
} from './support/references-scenario';

const CATEGORIES = 'categories';

const catalogViews: TableViewsData = {
  version: 1,
  defaultViewId: 'catalog',
  views: [{ id: 'catalog', name: 'Catalog' }],
};

describe('Native write lookup retries', () => {
  describe('updateRows', () => {
    it('retries a serialization failure of its referenced-table lookup and applies', async () => {
      const products = await givenProductsLinkedTo('c1');
      const lookup = failTableLookupOnceWith(
        kit,
        CATEGORIES,
        serializationFailure(),
      );

      const updated = await linkProductsTo(products, 'c2');

      expect(updated.rows.map((row) => row.data)).toEqual([{ link: 'c2' }]);
      expect(lookup.lookups()).toBe(2);
    });

    it('fails with an unrelated failure of its referenced-table lookup as it is', async () => {
      const products = await givenProductsLinkedTo('c1');
      const failure = new Error('Table lookup unavailable');
      failTableLookupOnceWith(kit, CATEGORIES, failure);

      await expect(linkProductsTo(products, 'c2')).rejects.toBe(failure);
    });
  });

  describe('renameTable', () => {
    it('retries a serialization failure of its views-row lookup and keeps the views', async () => {
      const draft = await givenDraftWithViews(kit, catalogViews);
      const lookup = failViewsRowLookupOnceWith(
        kit,
        draft.tableId,
        serializationFailure(),
      );

      await kit.draftApiService.apiRenameTable({
        revisionId: draft.draftRevisionId,
        tableId: draft.tableId,
        nextTableId: 'renamed-table',
      });

      await expect(
        readViews(kit, draft.draftRevisionId, 'renamed-table'),
      ).resolves.toEqual(catalogViews);
      expect(lookup.lookups()).toBe(2);
    });
  });

  async function givenProductsLinkedTo(
    categoryId: string,
  ): Promise<ReferringTable> {
    const categories = await givenTableWithRows(kit, {
      tableId: CATEGORIES,
      rowIds: ['c1', 'c2'],
    });

    return givenTableReferencingRow(kit, categories, {
      tableId: 'products',
      rowCount: 1,
      referencedRowId: categoryId,
    });
  }

  function linkProductsTo(products: ReferringTable, categoryId: string) {
    return kit.draftApiService.apiUpdateRows({
      revisionId: products.draftRevisionId,
      tableId: products.tableId,
      rows: products.rowIds.map((rowId) => ({
        rowId,
        data: { link: categoryId },
      })),
    });
  }

  let kit: DraftTestKit;

  beforeAll(async () => {
    kit = await createDraftTestKit({
      migrationOptions: { workerMode: 'disabled' },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await kit.close();
  });
});
