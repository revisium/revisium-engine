import {
  createDatabaseServiceTestKit,
  type DatabaseServiceTestKit,
} from 'src/__tests__/kit/create-database-service-test-kit';
import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { Unit } from 'src/features/partial-changes/catalogue/unit';
import {
  compareCodePoints,
  compareUnits,
} from 'src/features/partial-changes/catalogue/unit-order';

const IDS_IN_CODE_POINT_ORDER = [
  '-x',
  '9',
  'A',
  'B',
  '_x',
  'a',
  'b',
  'z',
  'é',
  'ё',
  '～',
  '😀',
];

describe('Listing order of units', () => {
  let kit: DatabaseServiceTestKit;

  beforeAll(async () => {
    kit = await createDatabaseServiceTestKit([]);
  });

  afterAll(async () => {
    await kit.close();
  });

  it('compares text by code point, not by locale or UTF-16 code unit', () => {
    const ids = [...IDS_IN_CODE_POINT_ORDER].reverse();

    expect(ids.sort(compareCodePoints)).toEqual(IDS_IN_CODE_POINT_ORDER);
  });

  it('compares text as PostgreSQL orders it under COLLATE "C"', async () => {
    const ids = [...IDS_IN_CODE_POINT_ORDER].reverse();

    expect([...ids].sort(compareCodePoints)).toEqual(
      await orderedInPostgres(ids),
    );
  });

  it('orders units by table id, row id with table-level units first, kind and path', () => {
    const listed = [
      unitOf({ kind: 'rowCreate', tableId: 'Products', rowId: 'p1' }),
      unitOf({ kind: 'structure', tableId: 'products' }),
      unitOf({ kind: 'views', tableId: 'products' }),
      unitOf({ kind: 'rowDelete', tableId: 'products', rowId: 'B' }),
      unitOf({ kind: 'field', tableId: 'products', rowId: 'a', path: '/B' }),
      unitOf({ kind: 'field', tableId: 'products', rowId: 'a', path: '/a' }),
      unitOf({ kind: 'rowColumns', tableId: 'products', rowId: 'a' }),
      unitOf({
        kind: 'rowRename',
        tableId: 'products',
        rowId: 'a',
        previousRowId: 'b',
      }),
      unitOf({ kind: 'rowCreate', tableId: 'products', rowId: 'é' }),
      unitOf({ kind: 'structure', tableId: 'é' }),
    ];

    expect([...listed].reverse().sort(compareUnits)).toEqual(listed);
  });

  it('orders units equal in table, row, kind and path by previous ids, absent first, then by key', () => {
    const listed = [
      unitOf({ kind: 'structure', tableId: 'products' }),
      unitOf({ kind: 'structure', tableId: 'products', previousTableId: 'A' }),
      unitOf({ kind: 'structure', tableId: 'products', previousTableId: 'a' }),
      unitOf({ kind: 'rowRename', tableId: 'products', rowId: 'p1' }, 'b'),
      unitOf({ kind: 'rowRename', tableId: 'products', rowId: 'p1' }, 'c'),
      unitOf({
        kind: 'rowRename',
        tableId: 'products',
        rowId: 'p1',
        previousRowId: 'p0',
      }),
    ];

    expect([...listed].reverse().sort(compareUnits)).toEqual(listed);
  });

  async function orderedInPostgres(ids: readonly string[]): Promise<string[]> {
    const rows = await kit.prismaService.$queryRaw<{ id: string }[]>`
      SELECT id FROM unnest(${ids}::text[]) AS ids(id) ORDER BY id COLLATE "C"
    `;

    return rows.map(({ id }) => id);
  }
});

function unitOf(unit: Unit, key = JSON.stringify(unit)): CatalogueUnit {
  return { key, tableIdentity: unit.tableId, rowIdentities: [], unit };
}
