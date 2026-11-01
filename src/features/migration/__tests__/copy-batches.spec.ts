import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import {
  getNumberSchema,
  getObjectSchema,
  getRefSchema,
  getReplacePatch,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import type { JsonPatch } from '@revisium/schema-toolkit/types';
import { expectMigrationAbsent } from 'src/__tests__/assertions/migration';
import {
  createMigrationTestKit,
  type MigrationTestKit,
} from 'src/__tests__/kit/create-migration-test-kit';
import type { InputJsonValue, TableMigration } from 'src/engine-prisma-types';
import {
  MigrationPhase,
  MigrationStatus,
} from 'src/features/migration/types/migration.types';
import { CleanupService } from 'src/infrastructure/database/cleanup.service';
import {
  failRightAfterFileRegistration,
  recordBatchWriteFailures,
  slowDownFirstBatchTransaction,
} from './support/batch-faults';
import {
  countFileLinks,
  expectRowsToLinkTheirFiles,
  readFileStates,
  readLinkedFilesOfTableVersion,
  readProjectFileBytes,
  uploadedFileOf,
} from './support/file-references';
import {
  beforeRetry,
  releaseStartedOwners,
  startOwnerUntil,
} from './support/migration-owners';
import {
  givenDraftOwnedTableWith,
  givenStartedFieldAddition,
  startAsyncUpdate,
  startFieldAddition,
  type DraftOwnedTable,
  type StartedMigration,
} from './support/migration-scenario';
import { readDraftTableVersionId, readRows } from './support/revision-records';

const BATCH_SIZE = 5;
const ROW_COUNT = 3 * BATCH_SIZE;
const ROW_OF_THE_THIRD_BATCH = 2 * BATCH_SIZE + 2;
const FIELD = 'price';
const FILE_FIELD = 'doc';
const OWNERS_TABLE_ID = 'owners';
const OWNER_ID = 'owner-1';
const SHORT_TRANSACTION_TIMEOUT_MS = 1000;
// Slower than TRANSACTION_TIMEOUT and faster than Prisma's 5 s default, so only the explicit timeout ends the batch.
const SLOW_BATCH_MS = 2 * SHORT_TRANSACTION_TIMEOUT_MS;

interface InvalidRow {
  row: string;
  given: (kit: MigrationTestKit) => Promise<DraftOwnedTable>;
  field: string;
  patches: JsonPatch[];
}

describe('Async migration copy batches', () => {
  describe('AM-34 a row of the third batch that the synchronous update refuses', () => {
    it.each<InvalidRow>([
      {
        row: 'data the target schema rejects',
        given: givenCodesWithOneMalformed,
        field: 'code',
        patches: [
          getReplacePatch({
            path: '/properties/code',
            value: getStringSchema({ pattern: '^[a-z]+$' }),
          }),
        ],
      },
      {
        row: 'a foreign key naming a missing row',
        given: givenOwnerReferencesWithOneMissing,
        field: 'ownerId',
        patches: [
          getReplacePatch({
            path: '/properties/ownerId',
            value: getStringSchema({ foreignKey: OWNERS_TABLE_ID }),
          }),
        ],
      },
    ])(
      '$row fails the migration ROW_INVALID with the synchronous message, without retries, and the Draft keeps its source',
      async ({ given, field, patches }) => {
        const refusal = await synchronousRefusalOf(
          await given(synchronousKit),
          patches,
        );
        const migration = await startAsyncUpdate(
          kit,
          await given(kit),
          field,
          patches,
        );
        const source = await readDraftTableVersionId(kit, migration);

        await expect(
          kit.migrationService.processMigration(migration.migrationId),
        ).resolves.toBe('failed');

        await expectMigrationState(migration, {
          status: MigrationStatus.FAILED,
          phase: MigrationPhase.COPYING,
          errorMessage: `ROW_INVALID: ${refusal}`,
          retryCount: 0,
          copiedRows: 2 * BATCH_SIZE,
          lockedBy: null,
        });
        await expect(readDraftTableVersionId(kit, migration)).resolves.toBe(
          source,
        );
      },
    );
  });

  it('AM-36 migrated rows link the blobs their files reference; project bytes stay unchanged and an orphan sweep after the swap tombstones none of them', async () => {
    const table = await givenDraftOwnedTableWith(kit, tableWithFiles());
    const projectBytes = await readProjectFileBytes(kit, table.projectId);
    const activeFiles = await readFileStates(kit, table.projectId);
    const migration = await startFieldAddition(kit, table, FIELD);

    await expectCompleted(migration);

    await expectRowsToLinkTheirFiles(kit, table, FILE_FIELD);
    await expect(readProjectFileBytes(kit, table.projectId)).resolves.toBe(
      projectBytes,
    );

    await kit.module.get(CleanupService).cleanOrphanedData();

    await expect(readFileStates(kit, table.projectId)).resolves.toEqual(
      activeFiles,
    );
    await expect(readProjectFileBytes(kit, table.projectId)).resolves.toBe(
      projectBytes,
    );
  });

  it('a failure right after a batch registers its files rolls back its checkpoint, shadow rows and blob links together, and the retry copies the batch once', async () => {
    const table = await givenDraftOwnedTableWith(kit, tableWithFiles());
    const projectBytes = await readProjectFileBytes(kit, table.projectId);
    const migration = await startFieldAddition(kit, table, FIELD);
    failRightAfterFileRegistration(kit, 2);

    const owner = await startOwnerUntil(
      kit,
      migration.migrationId,
      beforeRetry(kit),
    );

    const { sourceTableVersionId, shadowTableVersionId } =
      await expectMigrationState(migration, {
        status: MigrationStatus.COPYING,
        copiedRows: BATCH_SIZE,
        lastCopiedRowId: table.rowIds[BATCH_SIZE - 1],
        currentBatch: 1,
        retryCount: 0,
      });
    const sourceFiles = await readLinkedFilesOfTableVersion(
      kit,
      sourceTableVersionId,
    );
    await expect(
      readLinkedFilesOfTableVersion(kit, shadowTableVersionId),
    ).resolves.toEqual(sourceFiles.slice(0, BATCH_SIZE));
    await expect(countFileLinks(kit, table.projectId)).resolves.toBe(
      ROW_COUNT + BATCH_SIZE,
    );
    await expect(readProjectFileBytes(kit, table.projectId)).resolves.toBe(
      projectBytes,
    );

    await expect(owner.resume()).resolves.toBe('completed');

    const migratedRows = await readRows(kit, table);
    expect(migratedRows.map((row) => row.id)).toEqual(table.rowIds);
    await expectRowsToLinkTheirFiles(kit, table, FILE_FIELD);
    await expect(countFileLinks(kit, table.projectId)).resolves.toBe(
      2 * ROW_COUNT,
    );
    await expect(readProjectFileBytes(kit, table.projectId)).resolves.toBe(
      projectBytes,
    );
  });

  describe('the batch transaction', () => {
    it("runs under TRANSACTION_TIMEOUT, not Prisma's 5 s default: a batch slower than it times out and the copy resumes", async () => {
      const migration = await givenStartedFieldAddition(shortTimeoutKit, {
        rowCount: ROW_COUNT,
        field: FIELD,
      });
      const failures = recordBatchWriteFailures(shortTimeoutKit);
      slowDownFirstBatchTransaction(shortTimeoutKit, SLOW_BATCH_MS);

      await expect(
        shortTimeoutKit.migrationService.processMigration(
          migration.migrationId,
        ),
      ).resolves.toBe('completed');

      expect(failures).toEqual([
        expect.stringContaining(
          `timeout for this transaction was ${SHORT_TRANSACTION_TIMEOUT_MS} ms`,
        ),
      ]);
      await expectMigrationAbsent(
        shortTimeoutKit,
        migration.revisionId,
        migration.tableId,
      );
    });

    let shortTimeoutKit: MigrationTestKit;

    beforeAll(async () => {
      shortTimeoutKit = await createMigrationTestKit({
        batchSize: BATCH_SIZE,
        workerMode: 'disabled',
        transactionTimeoutMs: SHORT_TRANSACTION_TIMEOUT_MS,
      });
    });

    afterEach(async () => {
      await shortTimeoutKit.guard.verifyAndForget();
    });

    afterAll(async () => {
      await shortTimeoutKit.close();
    });
  });

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
    await releaseStartedOwners();
    jest.restoreAllMocks();
    await kit.guard.verifyAndForget();
    await synchronousKit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await synchronousKit.close();
    await kit.close();
  });

  async function synchronousRefusalOf(
    table: DraftOwnedTable,
    patches: JsonPatch[],
  ): Promise<string> {
    const refusal = await synchronousKit.draftApi
      .apiUpdateTable({
        revisionId: table.revisionId,
        tableId: table.tableId,
        patches,
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    if (!(refusal instanceof Error)) {
      throw new Error('The synchronous update was not refused');
    }

    return refusal.message;
  }

  async function expectCompleted(migration: StartedMigration): Promise<void> {
    await expect(
      kit.migrationService.processMigration(migration.migrationId),
    ).resolves.toBe('completed');
    await expectMigrationAbsent(kit, migration.revisionId, migration.tableId);
  }

  async function expectMigrationState(
    migration: StartedMigration,
    expected: Partial<TableMigration>,
  ): Promise<TableMigration> {
    const record = await kit.prisma.tableMigration.findUniqueOrThrow({
      where: { id: migration.migrationId },
    });

    expect(record).toMatchObject(expected);

    return record;
  }
});

function givenCodesWithOneMalformed(
  kit: MigrationTestKit,
): Promise<DraftOwnedTable> {
  return givenDraftOwnedTableWith(kit, {
    schema: getObjectSchema({
      ver: getNumberSchema(),
      code: getStringSchema(),
    }),
    rows: rowsWithOneInvalid('code', { valid: 'code', invalid: 'Not a code' }),
  });
}

async function givenOwnerReferencesWithOneMissing(
  kit: MigrationTestKit,
): Promise<DraftOwnedTable> {
  const table = await givenDraftOwnedTableWith(kit, {
    schema: getObjectSchema({
      ver: getNumberSchema(),
      ownerId: getStringSchema(),
    }),
    rows: rowsWithOneInvalid('ownerId', {
      valid: OWNER_ID,
      invalid: 'missing-owner',
    }),
  });
  await kit.draftApi.apiCreateTable({
    revisionId: table.revisionId,
    tableId: OWNERS_TABLE_ID,
    schema: getObjectSchema({ name: getStringSchema() }),
  });
  await kit.draftApi.apiCreateRows({
    revisionId: table.revisionId,
    tableId: OWNERS_TABLE_ID,
    rows: [{ rowId: OWNER_ID, data: { name: 'Owner' } }],
  });

  return table;
}

function rowsWithOneInvalid(
  field: string,
  values: { valid: string; invalid: string },
): InputJsonValue[] {
  return Array.from({ length: ROW_COUNT }, (_, index) => ({
    ver: index,
    [field]: index === ROW_OF_THE_THIRD_BATCH ? values.invalid : values.valid,
  }));
}

function tableWithFiles() {
  return {
    schema: getObjectSchema({
      ver: getNumberSchema(),
      [FILE_FIELD]: getRefSchema(SystemSchemaIds.File),
    }),
    rows: Array.from({ length: ROW_COUNT }, (_, index) => ({
      ver: index,
      [FILE_FIELD]: uploadedFileOf(`the file of row ${index}`),
    })),
  };
}
