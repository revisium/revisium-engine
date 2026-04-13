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
import { MigrationService } from 'src/features/migration/services/migration.service';
import {
  MigrationStatus,
  MigrationPhase,
} from 'src/features/migration/types/migration.types';
import { MigrationApiService } from 'src/features/migration/migration-api.service';
import { MigrationProgressService } from 'src/features/migration/services/migration-progress.service';
import { DraftApiService } from 'src/features/draft/draft-api.service';
import { RowApiService } from 'src/features/row/row-api.service';
import { TableApiService } from 'src/features/table/table-api.service';
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

describe('Migration bugs', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let draftApi: DraftApiService;
  let rowApi: RowApiService;
  let tableApi: TableApiService;
  let migrationService: MigrationService;
  let migrationApi: MigrationApiService;

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
    rowApi = module.get(RowApiService);
    tableApi = module.get(TableApiService);
    migrationService = module.get(MigrationService);
    migrationApi = module.get(MigrationApiService);
  });

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.$disconnect();
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
        status.status === MigrationStatus.COMPLETED ||
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

  describe('Bug: @@unique prevents second migration (major 1)', () => {
    it('should allow a second async migration after first completes', async () => {
      const { draftRevisionId, tableId } = await prepareTableWithRows();

      const result1 = await draftApi.apiUpdateTable({
        revisionId: draftRevisionId,
        tableId,
        patches: [
          {
            op: 'add',
            path: '/properties/field1',
            value: { type: JsonSchemaTypeName.String, default: '' },
          },
        ],
      });
      expect(result1.migrationId).toBeDefined();
      await waitForMigration(draftRevisionId, tableId);

      const result2 = await draftApi.apiUpdateTable({
        revisionId: draftRevisionId,
        tableId,
        patches: [
          {
            op: 'add',
            path: '/properties/field2',
            value: { type: JsonSchemaTypeName.String, default: '' },
          },
        ],
      });
      expect(result2.migrationId).toBeDefined();

      await waitForMigration(draftRevisionId, tableId);
    });
  });

  describe('Bug: retry re-creates shadow table (critical 2)', () => {
    it('should reuse existing shadow table on retry', async () => {
      const { draftRevisionId, tableId, draftTableVersionId } =
        await prepareTableWithRows();

      const shadowVersionId = 'shadow-already-exists-' + Date.now();
      await prisma.table.create({
        data: {
          versionId: shadowVersionId,
          createdId: 'created-1',
          id: tableId,
          readonly: false,
          system: false,
        },
      });

      await prisma.tableMigration.create({
        data: {
          revisionId: draftRevisionId,
          tableId,
          sourceTableVersionId: draftTableVersionId,
          shadowTableVersionId: shadowVersionId,
          status: MigrationStatus.PENDING,
          phase: MigrationPhase.COPYING,
          patches: [],
          previousSchema: testSchema,
          previousSchemaHash: 'h1',
          targetSchemaHash: 'h2',
          totalRows: ROW_COUNT,
          copiedRows: 0,
        },
      });

      const progressService = module.get(MigrationProgressService);
      const spy = jest.spyOn(progressService, 'setShadowTableVersionId');

      try {
        await migrationService.processMigration(
          (
            await prisma.tableMigration.findFirst({
              where: { revisionId: draftRevisionId, tableId },
            })
          )?.id ?? '',
        );
      } catch {
        // may fail on validate/swap — that's ok, we're testing initPhase
      }

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('Bug: schema not atomic with migration record (critical 1)', () => {
    it('should not update schema if migration record creation fails', async () => {
      const { draftRevisionId, tableId } = await prepareTableWithRows();

      const schemaBefore = await getSchemaData(
        prisma,
        draftRevisionId,
        tableId,
      );

      jest
        .spyOn(migrationService, 'createMigrationRecord')
        .mockRejectedValueOnce(new Error('DB write failed'));

      try {
        await draftApi.apiUpdateTable({
          revisionId: draftRevisionId,
          tableId,
          patches: [
            {
              op: 'add',
              path: '/properties/atomicField',
              value: { type: JsonSchemaTypeName.String, default: '' },
            },
          ],
        });
      } catch {
        // expected to throw
      }

      const schemaAfter = await getSchemaData(prisma, draftRevisionId, tableId);
      expect(schemaAfter).toEqual(schemaBefore);
    });
  });

  describe('Bug: no row validation in async path (major 2)', () => {
    it('should produce rows with correct schema fields after migration', async () => {
      const { draftRevisionId, tableId, rowIds } = await prepareTableWithRows();

      const result = await draftApi.apiUpdateTable({
        revisionId: draftRevisionId,
        tableId,
        patches: [
          {
            op: 'add',
            path: '/properties/validated',
            value: { type: JsonSchemaTypeName.Number, default: 0 },
          },
        ],
      });
      expect(result.migrationId).toBeDefined();

      const status = await waitForMigration(draftRevisionId, tableId);
      if (status && status.status === MigrationStatus.FAILED) {
        throw new Error(`Migration failed: ${status.errorMessage}`);
      }

      const tableSchema = (await tableApi.resolveTableSchema({
        revisionId: draftRevisionId,
        tableId,
      })) as { properties?: Record<string, unknown> } | null;
      expect(tableSchema?.properties).toHaveProperty('validated');

      for (const rowId of rowIds) {
        const row = await rowApi.getRow({
          revisionId: draftRevisionId,
          tableId,
          rowId,
        });
        expect(row).not.toBeNull();
        const data = row?.data as Record<string, unknown>;
        expect(data).toHaveProperty('validated');
        expect(typeof data.validated).toBe('number');
      }
    });
  });
});
