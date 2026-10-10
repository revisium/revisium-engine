import { BadRequestException } from '@nestjs/common';
import {
  getNumberSchema,
  getObjectSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import {
  givenReadingScenario,
  withReversedSnapshotSourceOrder,
} from './support/reading-scenario';
import { useReadingTestKit } from './support/reading-test-kit';

describe('Draft Changes reader: pagination', () => {
  const kit = useReadingTestKit();

  it('walks every changed row exactly once in stable order', async () => {
    const scenario = await givenReadingScenario(kit(), {
      head: { value: 1 },
      draft: { value: 2 },
    });
    await scenario.createDraftRow('created-row', { value: 3 });

    const first = await kit().changes.draftChangedRows({
      ...scenario.branch,
      tableId: scenario.tableId,
      page: { first: 1 },
    });
    const second = await kit().changes.draftChangedRows({
      ...scenario.branch,
      tableId: scenario.tableId,
      page: { first: 1, after: requireCursor(first.pageInfo.endCursor) },
    });
    const repeated = await kit().changes.draftChangedRows({
      ...scenario.branch,
      tableId: scenario.tableId,
      page: { first: 1 },
    });

    expect(first.totalCount).toBe(2);
    expect(first.edges).toHaveLength(1);
    expect(second.edges).toHaveLength(1);
    expect(first.pageInfo.hasNextPage).toBe(true);
    expect(requireCursor(second.pageInfo.endCursor)).toBeTruthy();
    expect(
      new Set([first.edges[0]?.node.rowId, second.edges[0]?.node.rowId]),
    ).toEqual(new Set([scenario.rowId, 'created-row']));
    expect(second.pageInfo.hasNextPage).toBe(false);
    expect(repeated.edges[0]?.node.rowId).toBe(first.edges[0]?.node.rowId);
  });

  it('walks changed tables with exact totals and no omitted items', async () => {
    const scenario = await givenReadingScenario(kit(), {
      head: { value: 1 },
      draft: { value: 2 },
    });
    const emptySchema = getObjectSchema({ value: getNumberSchema() });
    await scenario.createDraftTable('created-table', emptySchema);

    const first = await kit().changes.draftChangedTables({
      ...scenario.branch,
      page: { first: 1 },
    });
    const second = await kit().changes.draftChangedTables({
      ...scenario.branch,
      page: { first: 1, after: requireCursor(first.pageInfo.endCursor) },
    });

    expect(first.totalCount).toBe(2);
    expect(first.edges).toHaveLength(1);
    expect(second.edges).toHaveLength(1);
    expect(first.pageInfo.hasNextPage).toBe(true);
    expect(requireCursor(second.pageInfo.endCursor)).toBeTruthy();
    expect(second.pageInfo.hasNextPage).toBe(false);
    expect(
      new Set([first.edges[0]?.node.tableId, second.edges[0]?.node.tableId]),
    ).toEqual(new Set([scenario.tableId, 'created-table']));
  });

  it('keeps table and row ordering stable when source rows are reordered', async () => {
    const scenario = await givenReadingScenario(kit(), {
      head: { value: 1 },
      draft: { value: 2 },
      tableId: 'products',
      rowId: 'original-row',
    });
    await scenario.createDraftRow('row-b', { value: 3 });
    await scenario.createDraftRow('row-a', { value: 3 });
    await scenario.createDraftTable(
      'table-b',
      getObjectSchema({ value: getNumberSchema() }),
    );
    await scenario.createDraftTable(
      'table-a',
      getObjectSchema({ value: getNumberSchema() }),
    );

    async function readIds() {
      const [rows, tables] = await Promise.all([
        kit().changes.draftChangedRows({
          ...scenario.branch,
          tableId: scenario.tableId,
        }),
        kit().changes.draftChangedTables({ ...scenario.branch }),
      ]);
      return {
        rowIds: rows.edges.map(({ node }) => node.rowId),
        tableIds: tables.edges.map(({ node }) => node.tableId),
      };
    }

    const originalOrder = await readIds();
    const snapshot = await scenario.readSnapshot();
    const reversedOrder = await withReversedSnapshotSourceOrder(
      kit().changes,
      snapshot,
      readIds,
    );

    expectExactIds(originalOrder.rowIds, ['original-row', 'row-a', 'row-b']);
    expectExactIds(originalOrder.tableIds, ['products', 'table-a', 'table-b']);
    expectExactIds(reversedOrder.rowIds, ['original-row', 'row-a', 'row-b']);
    expectExactIds(reversedOrder.tableIds, ['products', 'table-a', 'table-b']);
    expect(reversedOrder).toEqual(originalOrder);
  });

  it.each([0, 1.5, 101])(
    'rejects page size %s outside the integer 1..100 range',
    async (first) => {
      const scenario = await givenReadingScenario(kit(), {
        head: { value: 1 },
        draft: { value: 2 },
      });

      await expect(
        kit().changes.draftRowChanges({
          ...scenario.branch,
          tableId: scenario.tableId,
          rowId: scenario.rowId,
          page: { first },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('rejects a cursor from another endpoint', async () => {
    const scenario = await givenReadingScenario(kit(), {
      head: { first: 1, second: 1 },
      draft: { first: 2, second: 2 },
    });
    const rowPage = await kit().changes.draftRowChanges({
      ...scenario.branch,
      tableId: scenario.tableId,
      rowId: scenario.rowId,
      page: { first: 1 },
    });

    await expect(
      kit().changes.draftChangedTables({
        ...scenario.branch,
        page: { first: 1, after: requireCursor(rowPage.pageInfo.endCursor) },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a malformed cursor', async () => {
    const scenario = await givenReadingScenario(kit(), {
      head: { value: 1 },
      draft: { value: 2 },
    });
    await expect(
      kit().changes.draftChangedTables({
        ...scenario.branch,
        page: { first: 1, after: 'not-a-reader-cursor' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a cursor from another row identity', async () => {
    const scenario = await givenReadingScenario(kit(), {
      head: { first: 1, second: 1 },
      draft: { first: 2, second: 2 },
    });
    await scenario.createDraftRow('another-row', { first: 3, second: 3 });
    const cursor = await kit().changes.draftRowChanges({
      ...scenario.branch,
      tableId: scenario.tableId,
      rowId: scenario.rowId,
      page: { first: 1 },
    });

    await expect(
      kit().changes.draftRowChanges({
        ...scenario.branch,
        tableId: scenario.tableId,
        rowId: 'another-row',
        page: { first: 1, after: requireCursor(cursor.pageInfo.endCursor) },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a row cursor after an actual-state write with unchanged stored hashes', async () => {
    const scenario = await givenReadingScenario(kit(), {
      head: { first: 1, second: 1 },
      draft: { first: 2, second: 2 },
    });
    const firstPage = await kit().changes.draftRowChanges({
      ...scenario.branch,
      tableId: scenario.tableId,
      rowId: scenario.rowId,
      page: { first: 1 },
    });
    await scenario.tamperDraftRowKeepingHash({ first: 3, second: 2 });

    await expect(
      kit().changes.draftRowChanges({
        ...scenario.branch,
        tableId: scenario.tableId,
        rowId: scenario.rowId,
        page: { first: 1, after: requireCursor(firstPage.pageInfo.endCursor) },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps cursor length independent of changed value size', async () => {
    const scenario = await givenReadingScenario(kit(), {
      head: { first: 'head-first', second: 'head-second' },
      draft: { first: 'draft-first', second: 'draft-second' },
      schema: getObjectSchema({
        first: getStringSchema(),
        second: getStringSchema(),
      }),
    });
    const firstPage = await kit().changes.draftRowChanges({
      ...scenario.branch,
      tableId: scenario.tableId,
      rowId: scenario.rowId,
      page: { first: 1 },
    });
    const originalCursor = requireCursor(firstPage.pageInfo.endCursor);

    await scenario.updateDraftRow({
      first: 'x'.repeat(4096),
      second: 'draft-second',
    });
    const updatedPage = await kit().changes.draftRowChanges({
      ...scenario.branch,
      tableId: scenario.tableId,
      rowId: scenario.rowId,
      page: { first: 1 },
    });
    const updatedCursor = requireCursor(updatedPage.pageInfo.endCursor);

    expect(firstPage.totalCount).toBe(2);
    expect(updatedPage.totalCount).toBe(2);
    expect(updatedPage.changes).toHaveLength(1);
    expect(updatedPage.tableId).toBe(firstPage.tableId);
    expect(updatedPage.rowId).toBe(firstPage.rowId);
    expect(updatedPage.changes[0]?.effect?.path).toBe(
      firstPage.changes[0]?.effect?.path,
    );
    expect(updatedCursor).toHaveLength(originalCursor.length);
  });
});

function requireCursor(cursor: string | null): string {
  if (!cursor) {
    throw new Error('Expected a nonempty page cursor.');
  }
  return cursor;
}

function expectExactIds(actual: string[], expected: string[]): void {
  expect(actual).toHaveLength(expected.length);
  expect(new Set(actual)).toEqual(new Set(expected));
}
