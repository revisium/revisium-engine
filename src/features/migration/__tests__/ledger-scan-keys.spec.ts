import { obj, str } from '@revisium/schema-toolkit/mocks';
import type { JsonSchema, Migration } from '@revisium/schema-toolkit/types';
import objectHash from 'object-hash';
import type { JsonValue, Row } from 'src/engine-prisma-types';
import {
  LedgerScan,
  type ScanReads,
} from 'src/features/migration/ledger-scan/ledger-scan';
import type {
  RowHashCount,
  ScannedRevision,
} from 'src/features/migration/ledger-scan/scan-revision-reader';
import {
  init,
  replayer,
} from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';

const PRODUCTS = 'products';
const productSchema = obj({ code: str() });

describe('Ledger scan evaluation keys', () => {
  it('keeps apart ledger and schema row versions whose ids join to the same text', async () => {
    const scan = new LedgerScan(
      new StoredVersions({
        'ledger/x': [migrationRow(init(PRODUCTS, productSchema))],
        ledger: [],
        schemas: [schemaRow('row', productSchema)],
        'other-schemas': [schemaRow('x/row', productSchema)],
      }),
      replayer,
      false,
    );

    const [ledgered] = await scan.tablesOf(revisionOf('ledger/x', 'schemas'));
    const [unledgered] = await scan.tablesOf(
      revisionOf('ledger', 'other-schemas'),
    );

    expect(ledgered?.check).toMatchObject({ kind: 'replayed', passes: true });
    expect(unledgered?.check).toEqual({
      kind: 'unledgered',
      detail: { reason: 'noLineage' },
    });
    expect(unledgered?.schemaEvaluation).not.toBe(ledgered?.schemaEvaluation);
  });
});

class StoredVersions implements ScanReads {
  constructor(private readonly rowsByVersion: Record<string, Row[]>) {}

  public readTableRows(tableVersionId: string): Promise<Row[]> {
    return Promise.resolve(this.rowsByVersion[tableVersionId] ?? []);
  }

  public readRowHashes(): Promise<RowHashCount[]> {
    return Promise.resolve([]);
  }
}

function revisionOf(
  migrationTableVersionId: string,
  schemaTableVersionId: string,
): ScannedRevision {
  return {
    revisionId: `${migrationTableVersionId}-revision`,
    tableVersionIds: new Map([[PRODUCTS, 'products-version']]),
    schemaTableVersionId,
    migrationTableVersionId,
  };
}

function migrationRow(migration: Migration): Row {
  return storedRow(migration.id, migration.id, migration);
}

function schemaRow(versionId: string, schema: JsonSchema): Row {
  return storedRow(PRODUCTS, versionId, schema);
}

function storedRow(id: string, versionId: string, data: object): Row {
  const createdAt = new Date(0);

  return {
    versionId,
    createdId: versionId,
    id,
    readonly: true,
    createdAt,
    updatedAt: createdAt,
    publishedAt: createdAt,
    data: data as JsonValue,
    meta: {},
    hash: objectHash(data),
    schemaHash: '',
  };
}
