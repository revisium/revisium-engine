import { num, numFormula, obj } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { JsonValue, Row } from 'src/engine-prisma-types';
import { RowMerger } from 'src/features/partial-changes/assembly/row-merger';

const ORDERS = 'orders';

const orderSchema = obj({
  price: num(),
  quantity: num(),
  total: numFormula('price * quantity'),
});

describe('RowMerger', () => {
  let kit: PartialChangesTestKit;
  let rowMerger: RowMerger;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
    rowMerger = kit.module.get(RowMerger);
  });

  afterAll(async () => {
    await kit.close();
  });

  describe('migrating Head rows into a Draft structure without pending history', () => {
    it('recomputes the new versions and leaves the snapshot rows untouched', async () => {
      const storedData = { price: 2, quantity: 3, total: 0 };
      const headRow = snapshotRowOf('o1', storedData);

      const merged = await rowMerger.migrateIntoDraftStructure(
        [headRow],
        { headSchema: orderSchema, pendingHistory: [] },
        { revisionId: 'draft-revision', tableId: ORDERS, schema: orderSchema },
      );

      expect(merged.map(({ data }) => data)).toEqual([
        { price: 2, quantity: 3, total: 6 },
      ]);
      expect(headRow.data).toBe(storedData);
      expect(storedData).toEqual({ price: 2, quantity: 3, total: 0 });
    });
  });

  function snapshotRowOf(rowId: string, data: JsonValue): Row {
    const committedAt = new Date('2026-01-01T00:00:00.000Z');

    return {
      versionId: `${rowId}-version`,
      createdId: `${rowId}-created`,
      id: rowId,
      readonly: true,
      createdAt: committedAt,
      updatedAt: committedAt,
      publishedAt: committedAt,
      data,
      meta: {},
      hash: 'stored-hash',
      schemaHash: 'stored-schema-hash',
    };
  }
});
