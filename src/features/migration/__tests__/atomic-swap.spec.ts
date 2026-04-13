import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { CqrsModule } from '@nestjs/cqrs';
import { JsonSchemaTypeName } from '@revisium/schema-toolkit/types';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
import { ShareModule } from 'src/features/share/share.module';
import { PluginModule } from 'src/features/plugin/plugin.module';
import { MigrationModule } from 'src/features/migration/migration.module';
import { DraftModule } from 'src/features/draft/draft.module';
import { RevisionModule } from 'src/features/revision/revision.module';
import { BranchModule } from 'src/features/branch/branch.module';
import { TableModule } from 'src/features/table/table.module';
import { RowModule } from 'src/features/row/row.module';
import { DraftRevisionModule } from 'src/features/draft-revision/draft-revision.module';
import { ViewsModule } from 'src/features/views/views.module';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { STORAGE_SERVICE } from 'src/infrastructure/storage/storage.interface';
import { StorageModule } from 'src/infrastructure/storage/storage.module';
import { MIGRATION_OPTIONS } from 'src/features/migration/migration.consts';
import { MigrationApiService } from 'src/features/migration/migration-api.service';
import { MigrationBatchService } from 'src/features/migration/services/migration-batch.service';
import { MigrationStatus } from 'src/features/migration/types/migration.types';
import { CommandBus } from '@nestjs/cqrs';
import { ApiRevertChangesCommand } from 'src/features/draft/commands/impl/api-revert-changes.command';
import { DraftApiService } from 'src/features/draft/draft-api.service';
import {
  prepareBranch,
  prepareRow,
  prepareTableWithSchema,
} from 'src/__tests__/utils/prepareProject';

const TEST_THRESHOLD = 10;
const ROW_COUNT = 15;

const mockStorage = {
  isAvailable: true,
  canServeFiles: false,
  uploadFile: jest.fn().mockResolvedValue({ key: 'uploads/fake.png' }),
  getPublicUrl: jest.fn((key: string) => `http://test-files/${key}`),
};

const testSchema = {
  type: JsonSchemaTypeName.Object as const,
  required: ['ver'],
  properties: {
    ver: { type: JsonSchemaTypeName.Number as const, default: 0 },
  },
  additionalProperties: false as const,
};

async function getSchemaData(
  prisma: PrismaService,
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
  let module: TestingModule;
  let prisma: PrismaService;
  let draftApi: DraftApiService;
  let migrationApi: MigrationApiService;
  let migrationBatchService: MigrationBatchService;
  let commandBus: CommandBus;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        DatabaseModule,
        CqrsModule,
        StorageModule.forRoot(),
        ShareModule,
        PluginModule,
        MigrationModule.forRoot(),
        RevisionModule,
        BranchModule,
        TableModule,
        RowModule,
        DraftRevisionModule,
        DraftModule,
        ViewsModule,
        CacheModule.register(),
      ],
    })
      .overrideProvider(STORAGE_SERVICE)
      .useValue(mockStorage)
      .overrideProvider(MIGRATION_OPTIONS)
      .useValue({ threshold: TEST_THRESHOLD, batchSize: 5 })
      .compile();

    await module.init();
    prisma = module.get(PrismaService);
    draftApi = module.get(DraftApiService);
    migrationApi = module.get(MigrationApiService);
    migrationBatchService = module.get(MigrationBatchService);
    commandBus = module.get(CommandBus);
  });

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await module.close();
  });

  async function prepareTableWithRows(rowCount = ROW_COUNT) {
    const branchData = await prepareBranch(prisma);
    const tableResult = await prepareTableWithSchema({
      prismaService: prisma,
      headRevisionId: branchData.headRevisionId,
      draftRevisionId: branchData.draftRevisionId,
      schemaTableVersionId: branchData.schemaTableVersionId,
      migrationTableVersionId: branchData.migrationTableVersionId,
      schema: testSchema,
    });

    const rowIds: string[] = [];
    for (let i = 0; i < rowCount; i++) {
      const result = await prepareRow({
        prismaService: prisma,
        headTableVersionId: tableResult.headTableVersionId,
        draftTableVersionId: tableResult.draftTableVersionId,
        data: { ver: i },
        dataDraft: { ver: i },
        schema: testSchema,
      });
      rowIds.push(result.rowId);
    }

    return { ...branchData, ...tableResult, rowIds };
  }

  async function waitForMigration(
    revisionId: string,
    tableId: string,
    maxWaitMs = 10000,
  ) {
    const pollInterval = 50;
    let waited = 0;
    while (waited < maxWaitMs) {
      const status = await migrationApi.getMigrationStatus({
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
      const status = await migrationApi.getMigrationStatus({
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
      const originalLoadBatchRows = migrationBatchService.loadBatchRows.bind(
        migrationBatchService,
      );
      let shouldPauseFirstBatch = true;

      jest
        .spyOn(migrationBatchService, 'loadBatchRows')
        .mockImplementation(async (...args) => {
          const rows = await originalLoadBatchRows(...args);

          if (shouldPauseFirstBatch) {
            shouldPauseFirstBatch = false;
            await firstBatchGate;
          }

          return rows;
        });

      const schemaBefore = await getSchemaData(
        prisma,
        draftRevisionId,
        tableId,
      );
      const schemaParsed = schemaBefore as Record<string, unknown> | null;
      expect(schemaParsed?.properties).not.toHaveProperty('newField');

      const result = await draftApi.apiUpdateTable({
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
          prisma,
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

      await draftApi.apiUpdateTable({
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

      const schemaAfter = await getSchemaData(prisma, draftRevisionId, tableId);
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
        prisma,
        draftRevisionId,
        tableId,
      );
      const beforeProps = (schemaBefore as Record<string, unknown>)
        ?.properties as Record<string, unknown> | undefined;
      expect(beforeProps).not.toHaveProperty('completed');

      const result = await draftApi.apiUpdateTable({
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

      const status = await migrationApi.getMigrationStatus({
        revisionId: draftRevisionId,
        tableId,
      });
      expect(status).toBeNull();

      const schemaAfter = await getSchemaData(prisma, draftRevisionId, tableId);
      const afterProps = (schemaAfter as Record<string, unknown>)
        ?.properties as Record<string, unknown> | undefined;
      expect(afterProps).toHaveProperty('completed');
      expect(afterProps).toHaveProperty('ver');

      for (const rowId of rowIds) {
        const row = await prisma.row.findFirst({
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
        prisma,
        draftRevisionId,
        tableId,
      );

      const result = await draftApi.apiUpdateTable({
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

      await migrationApi.abortMigration({
        revisionId: draftRevisionId,
        tableId,
      });

      await waitForMigration(draftRevisionId, tableId);

      const schemaAfterAbort = await getSchemaData(
        prisma,
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

      await prisma.tableMigration.create({
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
        commandBus.execute(
          new ApiRevertChangesCommand({ projectId, branchName }),
        ),
      ).resolves.toBeDefined();
    });

    it('revert should be blocked while migration is SWAPPING', async () => {
      const { draftRevisionId, projectId, branchName } =
        await prepareTableWithRows();

      await prisma.tableMigration.create({
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
        commandBus.execute(
          new ApiRevertChangesCommand({ projectId, branchName }),
        ),
      ).rejects.toThrow(/swap/i);
    });
  });

  describe('failed migration cleanup', () => {
    it('abortMigration should accept FAILED status and delete the record', async () => {
      const { draftRevisionId } = await prepareTableWithRows();

      await prisma.tableMigration.create({
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

      await migrationApi.abortMigration({
        revisionId: draftRevisionId,
        tableId: 'failed-table',
      });

      const record = await prisma.tableMigration.findFirst({
        where: {
          revisionId: draftRevisionId,
          tableId: 'failed-table',
        },
      });
      expect(record).toBeNull();
    });
  });
});
