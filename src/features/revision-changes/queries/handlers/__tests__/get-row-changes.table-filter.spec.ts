import { BadRequestException } from '@nestjs/common';
import { ChangeType, getTableCreatedId } from '../../../types';
import {
  createTableFilterTestKit,
  givenTableRowChanges,
} from '../../../__tests__/row-changes-table-filter.fixtures';

describe('rowChanges: table filter', () => {
  let kit: Awaited<ReturnType<typeof createTableFilterTestKit>>;

  beforeAll(async () => {
    kit = await createTableFilterTestKit();
  });

  afterAll(async () => {
    await kit?.close();
  });

  it('returns all table changes when the filter is omitted', async () => {
    const f = await givenTableRowChanges(kit, {
      from: 'products',
      to: 'products',
    });
    const result = await f.changes();
    expect(result.edges.map(({ node }) => getTableCreatedId(node))).toEqual(
      expect.arrayContaining([f.toTable?.createdId, f.unrelated.createdId]),
    );
    expect(result.totalCount).toBe(2);
  });

  it('filters by the table in the target revision', async () => {
    const f = await givenTableRowChanges(kit, {
      from: 'products',
      to: 'products',
    });
    const result = await f.changes({ tableId: 'products' });
    expect(result.edges.map(({ node }) => getTableCreatedId(node))).toEqual([
      f.toTable?.createdId,
    ]);
    expect(result.totalCount).toBe(1);
  });

  it('returns an empty page for an unknown table ID', async () => {
    const f = await givenTableRowChanges(kit, { to: 'products' });
    const result = await f.changes({ tableId: 'missing' });
    expect(result.edges).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(result.pageInfo).toEqual({
      startCursor: undefined,
      endCursor: undefined,
      hasNextPage: false,
      hasPreviousPage: false,
    });
  });

  it('returns a zero count for an unknown table on a count-only request', async () => {
    const f = await givenTableRowChanges(kit, { to: 'products' });
    const result = await f.changes({ tableId: 'missing', first: 0 });
    expect(result.totalCount).toBe(0);
  });

  it('filters removed table rows by their original identity', async () => {
    const f = await givenTableRowChanges(kit, { from: 'products' });
    const result = await f.changes({ tableId: 'products' });
    expect(result.edges.map(({ node }) => getTableCreatedId(node))).toEqual([
      f.fromTable?.createdId,
    ]);
    expect(result.edges[0]?.node.changeType).toBe(ChangeType.Removed);
    expect(result.totalCount).toBe(1);
  });

  it('filters a renamed table by its previous ID', async () => {
    const f = await givenTableRowChanges(kit, {
      from: 'products',
      to: 'catalog',
    });
    const result = await f.changes({ tableId: 'products' });
    expect(result.edges.map(({ node }) => getTableCreatedId(node))).toEqual([
      f.fromTable?.createdId,
    ]);
    expect(result.totalCount).toBe(1);
  });

  it('preserves filtering a renamed table by its current ID', async () => {
    const f = await givenTableRowChanges(kit, {
      from: 'products',
      to: 'catalog',
    });
    const result = await f.changes({ tableId: 'catalog' });
    expect(result.edges.map(({ node }) => getTableCreatedId(node))).toEqual([
      f.toTable?.createdId,
    ]);
  });

  it('prefers the target identity when a table ID has been reused', async () => {
    const f = await givenTableRowChanges(kit, {
      from: 'products',
      to: 'products',
      recreated: true,
    });
    const result = await f.changes({ tableId: 'products' });
    expect(result.edges.map(({ node }) => getTableCreatedId(node))).toEqual([
      f.toTable?.createdId,
    ]);
    expect(result.edges[0]?.node.changeType).toBe(ChangeType.Added);
    expect(result.totalCount).toBe(1);
  });

  it('resolves a removed table in the explicitly compared revision', async () => {
    const f = await givenTableRowChanges(kit, {
      from: 'products',
      intermediateParent: true,
    });
    const result = await f.changes({
      tableId: 'products',
      compareWithRevisionId: f.fromRevisionId,
    });
    expect(result.edges.map(({ node }) => getTableCreatedId(node))).toEqual([
      f.fromTable?.createdId,
    ]);
  });

  it('does not resolve a table outside the compared revision pair', async () => {
    await givenTableRowChanges(kit, { to: 'outside' });
    const f = await givenTableRowChanges(kit, { to: 'products' });
    const result = await f.changes({ tableId: 'outside' });
    expect(result.edges).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  it('keeps the filtered identity on the next page', async () => {
    const f = await givenTableRowChanges(kit, {
      from: 'products',
      rows: ['one', 'two'],
    });
    const first = await f.changes({ tableId: 'products', first: 1 });
    const next = await f.changes({
      tableId: 'products',
      first: 1,
      after: first.pageInfo.endCursor,
    });
    expect(next.edges.map(({ node }) => getTableCreatedId(node))).toEqual([
      f.fromTable?.createdId,
    ]);
    expect(next.totalCount).toBe(2);
    expect(next.pageInfo.hasNextPage).toBe(false);
  });

  it('combines a removed table filter with the change-type filter', async () => {
    const f = await givenTableRowChanges(kit, { from: 'products' });
    const result = await f.changes({
      tableId: 'products',
      changeTypes: [ChangeType.Added],
    });
    expect(result.edges).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  it('still validates page size for an unknown table', async () => {
    const f = await givenTableRowChanges(kit, { to: 'products' });
    await expect(
      f.changes({ tableId: 'missing', first: -1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('still validates the cursor for an unknown table', async () => {
    const f = await givenTableRowChanges(kit, { to: 'products' });
    await expect(
      f.changes({ tableId: 'missing', after: 'invalid' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
