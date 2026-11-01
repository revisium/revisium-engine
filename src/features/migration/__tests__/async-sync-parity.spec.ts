import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import {
  getAddPatch,
  getMovePatch,
  getNumberSchema,
  getObjectSchema,
  getRefSchema,
  getRemovePatch,
  getReplacePatch,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import type { JsonPatch } from '@revisium/schema-toolkit/types';
import { expectMigrationAbsent } from 'src/__tests__/assertions/migration';
import {
  createMigrationTestKit,
  type MigrationTestKit,
} from 'src/__tests__/kit/create-migration-test-kit';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { uploadedFileOf } from './support/file-references';
import {
  givenDraftOwnedTableWith,
  productViews,
  type DraftOwnedTable,
  type TableContents,
} from './support/migration-scenario';
import {
  readLedger,
  readRows,
  readSystemRow,
  readViews,
} from './support/revision-records';

const BATCH_SIZE = 5;
const ROW_COUNT = 3 * BATCH_SIZE;

interface TableUpdate {
  update: string;
  patches: JsonPatch[];
}

describe('AM-35 an async update writes what the synchronous update writes', () => {
  it.each<TableUpdate>([
    {
      update: 'a field addition',
      patches: [
        getAddPatch({ path: '/properties/price', value: getNumberSchema() }),
      ],
    },
    {
      update: 'a field removal',
      patches: [getRemovePatch({ path: '/properties/ver' })],
    },
    {
      update: 'a field rename',
      patches: [
        getMovePatch({ from: '/properties/ver', path: '/properties/version' }),
      ],
    },
    {
      update: 'a type change',
      patches: [
        getReplacePatch({ path: '/properties/ver', value: getStringSchema() }),
      ],
    },
    {
      update: 'a rename of the file field',
      patches: [
        getMovePatch({
          from: '/properties/doc',
          path: '/properties/attachment',
        }),
      ],
    },
  ])(
    '$update gives the same data, hashes, schema, history, ledger, views and blob links, and keeps the identity of the table and its rows',
    async ({ patches }) => {
      const contents = tableWithFiles();
      const synchronous = await givenDraftOwnedTableWith(
        synchronousKit,
        contents,
      );
      const asynchronous = await givenDraftOwnedTableWith(kit, contents);
      const identity = await readIdentity(kit, asynchronous);

      await updateSynchronously(synchronous, patches);
      await updateAsynchronously(asynchronous, patches);

      await expect(readUpdatedTable(kit, asynchronous)).resolves.toEqual(
        await readUpdatedTable(synchronousKit, synchronous),
      );
      await expect(readIdentity(kit, asynchronous)).resolves.toEqual(identity);
    },
  );

  let kit: MigrationTestKit;
  let synchronousKit: MigrationTestKit;

  beforeAll(async () => {
    kit = await createMigrationTestKit({
      batchSize: BATCH_SIZE,
      workerMode: 'disabled',
    });
    synchronousKit = await createMigrationTestKit({
      threshold: Number.MAX_SAFE_INTEGER,
      workerMode: 'disabled',
    });
  });

  afterEach(async () => {
    await kit.guard.verifyAndForget();
    await synchronousKit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await synchronousKit.close();
    await kit.close();
  });

  async function updateSynchronously(
    table: DraftOwnedTable,
    patches: JsonPatch[],
  ): Promise<void> {
    const result = await synchronousKit.draftApi.apiUpdateTable({
      revisionId: table.revisionId,
      tableId: table.tableId,
      patches,
    });

    expect(result.migrationId).toBeUndefined();
  }

  async function updateAsynchronously(
    table: DraftOwnedTable,
    patches: JsonPatch[],
  ): Promise<void> {
    const { migrationId } = await kit.draftApi.apiUpdateTable({
      revisionId: table.revisionId,
      tableId: table.tableId,
      patches,
    });

    if (!migrationId) {
      throw new Error('The table update did not start an async migration');
    }

    await expect(
      kit.migrationService.processMigration(migrationId),
    ).resolves.toBe('completed');
    await expectMigrationAbsent(kit, table.revisionId, table.tableId);
  }
});

function tableWithFiles(): TableContents {
  return {
    schema: getObjectSchema({
      ver: getNumberSchema(),
      doc: getRefSchema(SystemSchemaIds.File),
    }),
    rows: Array.from({ length: ROW_COUNT }, (_, index) => ({
      ver: index,
      doc: uploadedFileOf(`the file of row ${index}`),
    })),
    views: productViews,
  };
}

async function readUpdatedTable(kit: MigrationTestKit, table: DraftOwnedTable) {
  const schemaRow = await readSystemRow(kit, SystemTables.Schema, table);
  const ledger = await readLedger(kit, table.revisionId);
  const rows = await readRows(kit, table);

  return {
    schema: schemaRow?.data,
    history: (schemaRow?.meta as { patches: unknown; hash: string }[]).map(
      ({ patches, hash }) => ({ patches, hash }),
    ),
    ledger: ledger
      .filter((migration) => migration.tableId === table.tableId)
      .map(({ id: _id, ...migration }) => migration),
    views: await readViews(kit, table),
    rows: rows.map(({ id, data, hash, schemaHash, fileBlobs }) => ({
      id,
      data,
      hash,
      schemaHash,
      files: fileBlobs.map((blob) => blob.hash),
    })),
  };
}

async function readIdentity(kit: MigrationTestKit, table: DraftOwnedTable) {
  const tableVersion = await kit.prisma.table.findFirstOrThrow({
    where: {
      id: table.tableId,
      revisions: { some: { id: table.revisionId } },
    },
    select: { createdId: true, createdAt: true, system: true },
  });
  const rows = await readRows(kit, table);

  return {
    table: tableVersion,
    rows: rows.map(({ id, createdId, createdAt, publishedAt, meta }) => ({
      id,
      createdId,
      createdAt,
      publishedAt,
      meta,
    })),
  };
}
