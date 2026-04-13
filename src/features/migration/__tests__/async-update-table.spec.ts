import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { CqrsModule } from '@nestjs/cqrs';
import { JsonSchemaTypeName } from '@revisium/schema-toolkit/types';
import { nanoid } from 'nanoid';
import objectHash from 'object-hash';
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
import { MigrationStatus } from 'src/features/migration/types/migration.types';
import { MigrationApiService } from 'src/features/migration/migration-api.service';
import { DraftApiService } from 'src/features/draft/draft-api.service';
import { RowApiService } from 'src/features/row/row-api.service';
import type { InputJsonValue } from 'src/engine-prisma-types';
import {
  prepareBranch,
  prepareRow,
  prepareTableWithSchema,
} from 'src/__tests__/utils/prepareProject';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { tableViewsSchema } from 'src/features/share/schema/table-views-schema';
import type { TableViewsData } from 'src/features/views/types';

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

function createViewsData(): TableViewsData {
  return {
    version: 1,
    defaultViewId: 'main',
    views: [
      {
        id: 'main',
        name: 'Main',
        columns: [{ field: 'data.ver', width: 100 }],
        filters: {
          logic: 'and',
          conditions: [{ field: 'data.ver', operator: 'equals', value: 1 }],
        },
        sorts: [{ field: 'data.ver', direction: 'asc' }],
      },
    ],
  };
}

describe('Async Update Table', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let draftApi: DraftApiService;
  let rowApi: RowApiService;
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
    migrationService = module.get(MigrationService);
    migrationApi = module.get(MigrationApiService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function prepareTableWithRows() {
    const branchData = await prepareBranch(prisma);
    const {
      headRevisionId,
      draftRevisionId,
      schemaTableVersionId,
      migrationTableVersionId,
    } = branchData;

    const tableResult = await prepareTableWithSchema({
      prismaService: prisma,
      headRevisionId,
      draftRevisionId,
      schemaTableVersionId,
      migrationTableVersionId,
      schema: testSchema,
    });

    const rowIds: string[] = [];
    for (let i = 0; i < ROW_COUNT; i++) {
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

    return {
      ...branchData,
      ...tableResult,
      rowIds,
    };
  }

  async function setupViews(
    revisionId: string,
    tableId: string,
    viewsData: TableViewsData,
  ) {
    let viewsTable = await prisma.table.findFirst({
      where: {
        id: SystemTables.Views,
        revisions: { some: { id: revisionId } },
      },
    });

    if (!viewsTable) {
      viewsTable = await prisma.table.create({
        data: {
          id: SystemTables.Views,
          versionId: nanoid(),
          createdId: nanoid(),
          readonly: false,
          system: true,
          revisions: {
            connect: { id: revisionId },
          },
        },
      });
    }

    await prisma.row.create({
      data: {
        id: tableId,
        versionId: nanoid(),
        createdId: nanoid(),
        readonly: false,
        data: viewsData as unknown as InputJsonValue,
        hash: objectHash(viewsData),
        schemaHash: objectHash(tableViewsSchema),
        tables: {
          connect: { versionId: viewsTable.versionId },
        },
      },
    });
  }

  async function getViewsData(
    revisionId: string,
    tableId: string,
  ): Promise<TableViewsData | null> {
    const viewsTable = await prisma.table.findFirst({
      where: {
        id: SystemTables.Views,
        revisions: { some: { id: revisionId } },
      },
    });
    if (!viewsTable) {
      return null;
    }

    const viewsRow = await prisma.row.findFirst({
      where: {
        id: tableId,
        tables: { some: { versionId: viewsTable.versionId } },
      },
    });

    return (viewsRow?.data as TableViewsData | undefined) ?? null;
  }

  it('should use sync path for table below threshold', async () => {
    const branchData = await prepareBranch(prisma);
    const tableResult = await prepareTableWithSchema({
      prismaService: prisma,
      headRevisionId: branchData.headRevisionId,
      draftRevisionId: branchData.draftRevisionId,
      schemaTableVersionId: branchData.schemaTableVersionId,
      migrationTableVersionId: branchData.migrationTableVersionId,
      schema: testSchema,
    });

    // 0 rows — below threshold
    const result = await draftApi.apiUpdateTable({
      revisionId: branchData.draftRevisionId,
      tableId: tableResult.tableId,
      patches: [
        {
          op: 'add',
          path: '/properties/name',
          value: { type: JsonSchemaTypeName.String, default: '' },
        },
      ],
    });

    expect(result.table).not.toBeNull();
    expect(result.migrationId).toBeUndefined();
  });

  it('should detect threshold correctly with row count', async () => {
    const { draftTableVersionId } = await prepareTableWithRows();

    const count = await migrationService.countRows(draftTableVersionId);
    expect(count).toBe(ROW_COUNT);

    const shouldAsync =
      await migrationService.shouldUseAsyncMigration(draftTableVersionId);
    expect(shouldAsync).toBe(true);
  });

  it('should trigger async path for table above threshold', async () => {
    const { draftRevisionId, tableId } = await prepareTableWithRows();

    const result = await draftApi.apiUpdateTable({
      revisionId: draftRevisionId,
      tableId,
      patches: [
        {
          op: 'add',
          path: '/properties/name',
          value: { type: JsonSchemaTypeName.String, default: '' },
        },
      ],
    });

    expect(result.migrationId).toBeDefined();
    expect(result.migrationStatus).toBe('migrating');
  });

  it('should complete async migration and produce correct rows', async () => {
    const { draftRevisionId, tableId, rowIds } = await prepareTableWithRows();

    const result = await draftApi.apiUpdateTable({
      revisionId: draftRevisionId,
      tableId,
      patches: [
        {
          op: 'add',
          path: '/properties/label',
          value: { type: JsonSchemaTypeName.String, default: '' },
        },
      ],
    });

    expect(result.migrationId).toBeDefined();

    await waitForMigrationComplete(draftRevisionId, tableId);

    const status = await migrationApi.getMigrationStatus({
      revisionId: draftRevisionId,
      tableId,
    });
    expect(status).toBeNull();

    for (const rowId of rowIds) {
      const row = await rowApi.getRow({
        revisionId: draftRevisionId,
        tableId,
        rowId,
      });
      expect(row).not.toBeNull();
      const data = row?.data as Record<string, unknown>;
      expect(data).toHaveProperty('label');
      expect(typeof data.label).toBe('string');
    }
  });

  it('should migrate table views during async swap', async () => {
    const { draftRevisionId, tableId } = await prepareTableWithRows();
    await setupViews(draftRevisionId, tableId, createViewsData());

    const result = await draftApi.apiUpdateTable({
      revisionId: draftRevisionId,
      tableId,
      patches: [
        {
          op: 'move',
          from: '/properties/ver',
          path: '/properties/version',
        },
      ],
    });

    expect(result.migrationId).toBeDefined();

    await waitForMigrationComplete(draftRevisionId, tableId);

    const viewsData = await getViewsData(draftRevisionId, tableId);
    expect(viewsData?.views[0]?.columns).toEqual([
      { field: 'data.version', width: 100 },
    ]);
    expect(viewsData?.views[0]?.sorts).toEqual([
      { field: 'data.version', direction: 'asc' },
    ]);
    expect(viewsData?.views[0]?.filters?.conditions).toEqual([
      { field: 'data.version', operator: 'equals', value: 1 },
    ]);
  });

  it('should report active migrations during copy', async () => {
    const { draftRevisionId, tableId } = await prepareTableWithRows();

    // Create a PENDING migration manually
    await prisma.tableMigration.create({
      data: {
        revisionId: draftRevisionId,
        tableId,
        sourceTableVersionId: 'fake-source',
        status: MigrationStatus.COPYING,
        phase: 'COPYING',
        patches: [],
        previousSchema: {},
        previousSchemaHash: 'h1',
        targetSchemaHash: 'h2',
        totalRows: ROW_COUNT,
        copiedRows: 5,
      },
    });

    const active = await migrationApi.getActiveMigrations({
      revisionId: draftRevisionId,
    });
    expect(active.length).toBe(1);
    expect(active[0]?.tableId).toBe(tableId);
    expect(active[0]?.progress.copiedRows).toBe(5);
  });

  it('should abort an in-progress migration', async () => {
    const { draftRevisionId } = await prepareBranch(prisma);

    await prisma.tableMigration.create({
      data: {
        revisionId: draftRevisionId,
        tableId: 'abort-test-table',
        sourceTableVersionId: 'fake-source',
        status: MigrationStatus.COPYING,
        phase: 'COPYING',
        patches: [],
        previousSchema: {},
        previousSchemaHash: 'h1',
        targetSchemaHash: 'h2',
        totalRows: 100,
        copiedRows: 30,
      },
    });

    await migrationApi.abortMigration({
      revisionId: draftRevisionId,
      tableId: 'abort-test-table',
    });

    const status = await migrationApi.getMigrationStatus({
      revisionId: draftRevisionId,
      tableId: 'abort-test-table',
    });
    expect(status).toBeNull();
  });

  async function waitForMigrationComplete(
    revisionId: string,
    tableId: string,
    maxWaitMs = 10000,
  ) {
    const pollInterval = 100;
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
});
