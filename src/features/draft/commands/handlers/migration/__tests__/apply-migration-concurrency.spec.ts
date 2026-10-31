import objectHash from 'object-hash';
import { getStringSchema } from '@revisium/schema-toolkit/mocks';
import type { Migration } from '@revisium/schema-toolkit/types';
import {
  createDraftTestKit,
  type DraftTestKit,
} from 'src/__tests__/kit/create-draft-test-kit';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { applyMigrationWhileAnotherWriterCommits } from './support/held-migration-import';
import {
  freezeNativeClock,
  givenNativeTable,
  nativeSchema,
  readNativeLedger,
} from './support/native-migration-scenario';

const lastMigrationId = '2099-01-01T00:00:00.000Z';
const importedMigrationId = '2099-01-01T00:00:00.500Z';
const nativeMigrationId = '2099-01-01T00:00:01.000Z';

const createOrders: Migration = {
  id: importedMigrationId,
  changeType: 'init',
  tableId: 'orders',
  schema: nativeSchema,
  hash: objectHash(nativeSchema),
};

const importedTableChanges: Migration[] = [
  createOrders,
  {
    id: importedMigrationId,
    changeType: 'update',
    tableId: 'products',
    patches: [
      { op: 'add', path: '/properties/extra', value: getStringSchema() },
    ],
    hash: '',
  },
  {
    id: importedMigrationId,
    changeType: 'rename',
    tableId: 'products',
    nextTableId: 'renamed-products',
  },
  {
    id: importedMigrationId,
    changeType: 'remove',
    tableId: 'products',
  },
];

describe('Concurrent applyMigrations', () => {
  let kit: DraftTestKit;

  beforeAll(async () => {
    kit = await createDraftTestKit({
      migrationOptions: { workerMode: 'disabled' },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  afterAll(async () => {
    await kit.close();
  });

  it('records a migration once and skips it in the call that another call overtook', async () => {
    const { draftRevisionId } = await givenNativeTable(kit, lastMigrationId);

    const { held, another } = await applyMigrationWhileAnotherWriterCommits(
      kit,
      { revisionId: draftRevisionId, migration: createOrders },
      () =>
        kit.draftApiService.applyMigrations({
          revisionId: draftRevisionId,
          migrations: [createOrders],
        }),
    );

    expect(another).toEqual([{ id: importedMigrationId, status: 'applied' }]);
    expect(held).toEqual([{ id: importedMigrationId, status: 'skipped' }]);
    expect(await readLedgerIds(draftRevisionId)).toEqual([
      lastMigrationId,
      importedMigrationId,
    ]);
  });

  it.each(importedTableChanges)(
    'fails an imported $changeType and writes nothing when a later migration is recorded first',
    async (migration) => {
      const { draftRevisionId } = await givenNativeTable(kit, lastMigrationId);
      freezeNativeClock(nativeMigrationId);

      const { held } = await applyMigrationWhileAnotherWriterCommits(
        kit,
        { revisionId: draftRevisionId, migration },
        () =>
          kit.draftApiService.apiCreateTable({
            revisionId: draftRevisionId,
            tableId: 'customers',
            schema: nativeSchema,
          }),
      );

      expect(held).toEqual([
        {
          id: importedMigrationId,
          status: 'failed',
          error: `Provided id (${importedMigrationId}) must be after last migration date (${nativeMigrationId}).`,
        },
      ]);
      expect(await readLedgerIds(draftRevisionId)).toEqual([
        lastMigrationId,
        nativeMigrationId,
      ]);
      expect(await readTableSchemas(draftRevisionId)).toEqual({
        customers: nativeSchema,
        products: nativeSchema,
      });
    },
  );

  async function readLedgerIds(revisionId: string) {
    const ledger = await readNativeLedger(kit, revisionId);

    return ledger.map(({ id }) => id);
  }

  async function readTableSchemas(revisionId: string) {
    const schemaRows = await kit.prismaService.row.findMany({
      where: {
        tables: {
          some: {
            id: SystemTables.Schema,
            revisions: { some: { id: revisionId } },
          },
        },
      },
    });

    return Object.fromEntries(schemaRows.map(({ id, data }) => [id, data]));
  }
});
