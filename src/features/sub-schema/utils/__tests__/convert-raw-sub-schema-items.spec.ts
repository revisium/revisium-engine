import {
  convertRawSubSchemaItems,
  SubSchemaRawItem,
} from '../get-sub-schema-items-sql';

describe('convertRawSubSchemaItems', () => {
  const createRawItem = (
    overrides: Partial<SubSchemaRawItem> = {},
  ): SubSchemaRawItem => ({
    tableId: 'table-1',
    rowId: 'row-1',
    rowVersionId: 'row-version-1',
    fieldPath: 'file',
    row_versionId: 'row-version-1',
    row_createdId: 'row-created-1',
    row_id: 'row-1',
    row_readonly: false,
    row_createdAt: new Date('2024-01-01'),
    row_updatedAt: new Date('2024-01-01'),
    row_publishedAt: null as unknown as Date,
    row_data: { file: { fileId: 'f1', url: '' } },
    row_meta: {},
    row_hash: 'hash-1',
    row_schemaHash: 'schema-hash-1',
    table_versionId: 'table-version-1',
    table_createdId: 'table-created-1',
    table_id: 'table-1',
    table_readonly: false,
    table_createdAt: new Date('2024-01-01'),
    table_updatedAt: new Date('2024-01-01'),
    table_system: false,
    ...overrides,
  });

  it('should convert raw items to parsed items', () => {
    const rawItems = [createRawItem()];

    const result = convertRawSubSchemaItems(rawItems);

    expect(result).toHaveLength(1);
    const item0 = result[0] as (typeof result)[number];
    expect(item0.tableId).toBe('table-1');
    expect(item0.rowId).toBe('row-1');
    expect(item0.fieldPath).toBe('file');
    expect(item0.row.id).toBe('row-1');
    expect(item0.table.id).toBe('table-1');
  });

  it('should reuse same Row object for items with same rowVersionId', () => {
    const rawItems = [
      createRawItem({ fieldPath: 'icon' }),
      createRawItem({ fieldPath: 'images[0]' }),
      createRawItem({ fieldPath: 'images[1]' }),
    ];

    const result = convertRawSubSchemaItems(rawItems);

    expect(result).toHaveLength(3);
    const r0 = result[0] as (typeof result)[number];
    const r1 = result[1] as (typeof result)[number];
    const r2 = result[2] as (typeof result)[number];
    expect(r0.row).toBe(r1.row);
    expect(r1.row).toBe(r2.row);
  });

  it('should reuse same Table object for items with same tableVersionId', () => {
    const rawItems = [
      createRawItem({ rowVersionId: 'rv-1', row_versionId: 'rv-1' }),
      createRawItem({ rowVersionId: 'rv-2', row_versionId: 'rv-2' }),
    ];

    const result = convertRawSubSchemaItems(rawItems);

    expect(result).toHaveLength(2);
    const t0 = result[0] as (typeof result)[number];
    const t1 = result[1] as (typeof result)[number];
    expect(t0.table).toBe(t1.table);
  });

  it('should create different Row objects for different rowVersionId', () => {
    const rawItems = [
      createRawItem({
        rowId: 'row-1',
        rowVersionId: 'rv-1',
        row_versionId: 'rv-1',
        row_id: 'row-1',
      }),
      createRawItem({
        rowId: 'row-2',
        rowVersionId: 'rv-2',
        row_versionId: 'rv-2',
        row_id: 'row-2',
      }),
    ];

    const result = convertRawSubSchemaItems(rawItems);

    expect(result).toHaveLength(2);
    const d0 = result[0] as (typeof result)[number];
    const d1 = result[1] as (typeof result)[number];
    expect(d0.row).not.toBe(d1.row);
    expect(d0.row.id).toBe('row-1');
    expect(d1.row.id).toBe('row-2');
  });

  it('should create different Table objects for different tableVersionId', () => {
    const rawItems = [
      createRawItem({
        tableId: 'table-1',
        table_versionId: 'tv-1',
        table_id: 'table-1',
      }),
      createRawItem({
        tableId: 'table-2',
        table_versionId: 'tv-2',
        table_id: 'table-2',
      }),
    ];

    const result = convertRawSubSchemaItems(rawItems);

    expect(result).toHaveLength(2);
    const e0 = result[0] as (typeof result)[number];
    const e1 = result[1] as (typeof result)[number];
    expect(e0.table).not.toBe(e1.table);
  });

  it('should allow mutation of shared row.data to affect all items', () => {
    const rawItems = [
      createRawItem({ fieldPath: 'file1' }),
      createRawItem({ fieldPath: 'file2' }),
    ];

    const result = convertRawSubSchemaItems(rawItems);

    const m0 = result[0] as (typeof result)[number];
    const m1 = result[1] as (typeof result)[number];
    (m0.row.data as Record<string, unknown>).url = 'http://example.com';

    expect((m1.row.data as Record<string, unknown>).url).toBe(
      'http://example.com',
    );
  });
});
