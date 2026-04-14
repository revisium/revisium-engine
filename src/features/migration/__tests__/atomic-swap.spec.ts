import { JsonSchemaTypeName } from '@revisium/schema-toolkit/types';
import type { MigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';
import { createMigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';
import { givenMigrationTableWithRows } from 'src/__tests__/fixtures/scenarios/given-migration-table-with-rows';
import { MigrationStatus } from 'src/features/migration/types/migration.types';
import { ApiRevertChangesCommand } from 'src/features/draft/commands/impl/api-revert-changes.command';

const TEST_THRESHOLD = 10;
const ROW_COUNT = 15;

const testSchema = {
  type: JsonSchemaTypeName.Object as const,
  required: ['ver'],
  properties: {
    ver: { type: JsonSchemaTypeName.Number as const, default: 0 },
  },
  additionalProperties: false as const,
};

async function getSchemaData(
  prisma: MigrationTestKit['prisma'],
  revisionId: string,
  tableId: string,
) {
  const schemaTable = await prisma.table.findFirst({
    where: {
      id: 'revisium_schema_table',
      revisions: { some: { id: revisionId } },
    },
  });
  if (!schemaTable) {
    return null;
  }
  const schemaRow = await prisma.row.findFirst({
    where: {
      id: tableId,
      tables: { some: { versionId: schemaTable.versionId } },
    },
  });
  return schemaRow?.data ?? null;
}

describe('Atomic swap — schema consistency', () => {
  let kit: MigrationTestKit;

  beforeAll(async () => {
    kit = await createMigrationTestKit({
      threshold: TEST_THRESHOLD,
      batchSize: 5,
    });
  });

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    if (kit) {
      await kit.close();
    }
  });

  async function prepareTableWithRows(rowCount = ROW_COUNT) {
    return givenMigrationTableWithRows({
      prisma: kit.prisma,
      schema: testSchema,
      rowCount,
    });
  }

  async function waitForMigration(
    revisionId: string,
    tableId: string,
    maxWaitMs = 10000,
  ) {
    const pollInterval = 50;
    let waited = 0;
    while (waited < maxWaitMs) {
      const status = await kit.migrationApi.getMigrationStatus({
        revisionId,
        tableId,
      });
      if (!status) {
        return null;
      }
      if (
        status.status === MigrationStatus.FAILED ||
        status.status === MigrationStatus.CANCELLED
      ) {
        return status;
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      waited += pollInterval;
    }
    throw new Error(`Migration did not complete within ${maxWaitMs}ms`);
  }

  async function waitForMigrationStatus(
    revisionId: string,
    tableId: string,
    targetStatus: MigrationStatus,
    maxWaitMs = 10000,
  ) {
    const pollInterval = 50;
    let waited = 0;

    while (waited < maxWaitMs) {
      const status = await kit.migrationApi.getMigrationStatus({
        revisionId,
        tableId,
      });

      if (status?.status === targetStatus) {
        return status;
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      waited += pollInterval;
    }

    throw new Error(
      `Migration did not reach ${targetStatus} within ${maxWaitMs}ms`,
    );
  }

  describe('schema unchanged during copy', () => {
    it('schema row should NOT have new field while migration is in progress', async () => {
      const { draftRevisionId, tableId } = await prepareTableWithRows();
      let releaseFirstBatch: (() => void) | undefined;
      const firstBatchGate = new Promise<void>((resolve) => {
        releaseFirstBatch = resolve;
      });
      const originalLoadBatchRows =
        kit.migrationBatchService.loadBatchRows.bind(kit.migrationBatchService);
      let shouldPauseFirstBatch = true;

      jest
        .spyOn(kit.migrationBatchService, 'loadBatchRows')
        .mockImplementation(async (...args) => {
          const rows = await originalLoadBatchRows(...args);

          if (shouldPauseFirstBatch) {
            shouldPauseFirstBatch = false;
            await firstBatchGate;
          }

          return rows;
        });

      const schemaBefore = await getSchemaData(
        kit.prisma,
        draftRevisionId,
        tableId,
      );
      const schemaParsed = schemaBefore as Record<string, unknown> | null;
      expect(schemaParsed?.properties).not.toHaveProperty('newField');

      const result = await kit.draftApi.apiUpdateTable({
        revisionId: draftRevisionId,
        tableId,
        patches: [
          {
            op: 'add',
            path: '/properties/newField',
            value: { type: JsonSchemaTypeName.String, default: '' },
          },
        ],
      });
      expect(result.migrationId).toBeDefined();

      try {
        await waitForMigrationStatus(
          draftRevisionId,
          tableId,
          MigrationStatus.COPYING,
        );

        const schemaDuringCopy = await getSchemaData(
          kit.prisma,
          draftRevisionId,
          tableId,
        );
        const duringParsed = schemaDuringCopy as Record<string, unknown> | null;
        const duringProps = duringParsed?.properties as
          | Record<string, unknown>
          | undefined;
        expect(duringProps).not.toHaveProperty('newField');
      } finally {
        releaseFirstBatch?.();
      }

      await waitForMigration(draftRevisionId, tableId);
    });

    it('schema row should have new field only AFTER swap completes', async () => {
      const { draftRevisionId, tableId } = await prepareTableWithRows();

      await kit.draftApi.apiUpdateTable({
        revisionId: draftRevisionId,
        tableId,
        patches: [
          {
            op: 'add',
            path: '/properties/swapped',
            value: { type: JsonSchemaTypeName.String, default: '' },
          },
        ],
      });

      await waitForMigration(draftRevisionId, tableId);

      const schemaAfter = await getSchemaData(
        kit.prisma,
        draftRevisionId,
        tableId,
      );
      const afterParsed = schemaAfter as Record<string, unknown> | null;
      const afterProps = afterParsed?.properties as
        | Record<string, unknown>
        | undefined;
      expect(afterProps).toHaveProperty('swapped');
    });
  });

  describe('complete end state', () => {
    it('after migration: schema correct, rows correct, record deleted, table accessible', async () => {
      const { draftRevisionId, tableId, rowIds } = await prepareTableWithRows();

      const schemaBefore = await getSchemaData(
        kit.prisma,
        draftRevisionId,
        tableId,
      );
      const beforeProps = (schemaBefore as Record<string, unknown>)
        ?.properties as Record<string, unknown> | undefined;
      expect(beforeProps).not.toHaveProperty('completed');

      const result = await kit.draftApi.apiUpdateTable({
        revisionId: draftRevisionId,
        tableId,
        patches: [
          {
            op: 'add',
            path: '/properties/completed',
            value: { type: JsonSchemaTypeName.Number, default: 42 },
          },
        ],
      });
      expect(result.migrationId).toBeDefined();

      await waitForMigration(draftRevisionId, tableId);

      const status = await kit.migrationApi.getMigrationStatus({
        revisionId: draftRevisionId,
        tableId,
      });
      expect(status).toBeNull();

      const schemaAfter = await getSchemaData(
        kit.prisma,
        draftRevisionId,
        tableId,
      );
      const afterProps = (schemaAfter as Record<string, unknown>)
        ?.properties as Record<string, unknown> | undefined;
      expect(afterProps).toHaveProperty('completed');
      expect(afterProps).toHaveProperty('ver');

      for (const rowId of rowIds) {
        const row = await kit.prisma.row.findFirst({
          where: {
            id: rowId,
            tables: {
              some: {
                id: tableId,
                revisions: { some: { id: draftRevisionId } },
              },
            },
          },
        });
        expect(row).not.toBeNull();
        const data = row?.data as Record<string, unknown>;
        expect(data).toHaveProperty('completed');
        expect(data).toHaveProperty('ver');
      }
    });
  });

  describe('abort leaves schema clean', () => {
    it('schema should be unchanged after abort', async () => {
      const { draftRevisionId, tableId } = await prepareTableWithRows();

      const schemaBefore = await getSchemaData(
        kit.prisma,
        draftRevisionId,
        tableId,
      );

      const result = await kit.draftApi.apiUpdateTable({
        revisionId: draftRevisionId,
        tableId,
        patches: [
          {
            op: 'add',
            path: '/properties/abortedField',
            value: { type: JsonSchemaTypeName.String, default: '' },
          },
        ],
      });
      expect(result.migrationId).toBeDefined();

      await kit.migrationApi.abortMigration({
        revisionId: draftRevisionId,
        tableId,
      });

      await waitForMigration(draftRevisionId, tableId);

      const schemaAfterAbort = await getSchemaData(
        kit.prisma,
        draftRevisionId,
        tableId,
      );
      expect(schemaAfterAbort).toEqual(schemaBefore);
    });
  });

  describe('revert during migration', () => {
    it('revert should not be blocked by migration guard', async () => {
      const { draftRevisionId, projectId, branchName } =
        await prepareTableWithRows();

      await kit.prisma.tableMigration.create({
        data: {
          revisionId: draftRevisionId,
          tableId: 'migrating-table',
          sourceTableVersionId: 'source-v1',
          status: MigrationStatus.COPYING,
          phase: 'COPYING',
          patches: [],
          previousSchema: {},
          previousSchemaHash: 'h1',
          targetSchemaHash: 'h2',
          totalRows: 100,
          copiedRows: 50,
        },
      });

      await expect(
        kit.commandBus.execute(
          new ApiRevertChangesCommand({ projectId, branchName }),
        ),
      ).resolves.toBeDefined();
    });

    it('revert should be blocked while migration is SWAPPING', async () => {
      const { draftRevisionId, projectId, branchName } =
        await prepareTableWithRows();

      await kit.prisma.tableMigration.create({
        data: {
          revisionId: draftRevisionId,
          tableId: 'swapping-table',
          sourceTableVersionId: 'source-v1',
          status: MigrationStatus.SWAPPING,
          phase: 'SWAPPING',
          patches: [],
          previousSchema: {},
          previousSchemaHash: 'h1',
          targetSchemaHash: 'h2',
          totalRows: 100,
          copiedRows: 100,
        },
      });

      await expect(
        kit.commandBus.execute(
          new ApiRevertChangesCommand({ projectId, branchName }),
        ),
      ).rejects.toThrow(/swap/i);
    });
  });

  describe('failed migration cleanup', () => {
    it('abortMigration should accept FAILED status and delete the record', async () => {
      const { draftRevisionId } = await prepareTableWithRows();

      await kit.prisma.tableMigration.create({
        data: {
          revisionId: draftRevisionId,
          tableId: 'failed-table',
          sourceTableVersionId: 'source-v1',
          status: MigrationStatus.FAILED,
          phase: 'COPYING',
          patches: [],
          previousSchema: {},
          previousSchemaHash: 'h1',
          targetSchemaHash: 'h2',
          totalRows: 100,
          errorMessage: 'something broke',
        },
      });

      await kit.migrationApi.abortMigration({
        revisionId: draftRevisionId,
        tableId: 'failed-table',
      });

      const record = await kit.prisma.tableMigration.findFirst({
        where: {
          revisionId: draftRevisionId,
          tableId: 'failed-table',
        },
      });
      expect(record).toBeNull();
    });
  });
});
