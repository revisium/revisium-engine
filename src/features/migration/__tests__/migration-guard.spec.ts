import { HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { CqrsModule } from '@nestjs/cqrs';
import {
  getObjectSchema,
  getNumberSchema,
} from '@revisium/schema-toolkit/mocks';
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
import { DraftApiService } from 'src/features/draft/draft-api.service';
import { MigrationLockedException } from 'src/features/migration/exceptions/migration-locked.exception';
import { MigrationStatus } from 'src/features/migration/types/migration.types';
import { prepareProject } from 'src/__tests__/utils/prepareProject';

const mockStorage = {
  isAvailable: true,
  canServeFiles: false,
  uploadFile: jest.fn().mockResolvedValue({ key: 'uploads/fake.png' }),
  getPublicUrl: jest.fn((key: string) => `http://test-files/${key}`),
};

describe('Migration Guard (integration)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let draftApi: DraftApiService;

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
      .compile();

    await module.init();
    prisma = module.get(PrismaService);
    draftApi = module.get(DraftApiService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createActiveMigration(draftRevisionId: string) {
    return prisma.tableMigration.create({
      data: {
        revisionId: draftRevisionId,
        tableId: 'migrating-table',
        sourceTableVersionId: 'source-v1',
        status: MigrationStatus.COPYING,
        phase: 'COPYING',
        patches: [],
        previousSchema: {},
        previousSchemaHash: 'hash1',
        targetSchemaHash: 'hash2',
        totalRows: 1000,
        copiedRows: 500,
      },
    });
  }

  it('apiCreateRow should return 423 during active migration', async () => {
    const { draftRevisionId, tableId } = await prepareProject(prisma);
    await createActiveMigration(draftRevisionId);

    await expect(
      draftApi.apiCreateRow({
        revisionId: draftRevisionId,
        tableId,
        rowId: 'new-row',
        data: { ver: 1 },
      }),
    ).rejects.toThrow(MigrationLockedException);
  });

  it('apiUpdateRow should return 423 during active migration', async () => {
    const { draftRevisionId, tableId, rowId } = await prepareProject(prisma);
    await createActiveMigration(draftRevisionId);

    await expect(
      draftApi.apiUpdateRow({
        revisionId: draftRevisionId,
        tableId,
        rowId,
        data: { ver: 99 },
      }),
    ).rejects.toThrow(MigrationLockedException);
  });

  it('apiCreateTable should return 423 during active migration', async () => {
    const { draftRevisionId } = await prepareProject(prisma);
    await createActiveMigration(draftRevisionId);

    await expect(
      draftApi.apiCreateTable({
        revisionId: draftRevisionId,
        tableId: 'new-table',
        schema: getObjectSchema({ name: getNumberSchema() }),
      }),
    ).rejects.toThrow(MigrationLockedException);
  });

  it('apiUpdateTable should return 423 during active migration', async () => {
    const { draftRevisionId, tableId } = await prepareProject(prisma);
    await createActiveMigration(draftRevisionId);

    await expect(
      draftApi.apiUpdateTable({
        revisionId: draftRevisionId,
        tableId,
        patches: [
          {
            op: 'replace',
            path: '/properties/ver',
            value: { type: JsonSchemaTypeName.String, default: '' },
          },
        ],
      }),
    ).rejects.toThrow(MigrationLockedException);
  });

  it('apiRemoveRow should return 423 during active migration', async () => {
    const { draftRevisionId, tableId, rowId } = await prepareProject(prisma);
    await createActiveMigration(draftRevisionId);

    await expect(
      draftApi.apiRemoveRow({
        revisionId: draftRevisionId,
        tableId,
        rowId,
      }),
    ).rejects.toThrow(MigrationLockedException);
  });

  it('apiRemoveTable should return 423 during active migration', async () => {
    const { draftRevisionId, tableId } = await prepareProject(prisma);
    await createActiveMigration(draftRevisionId);

    await expect(
      draftApi.apiRemoveTable({
        revisionId: draftRevisionId,
        tableId,
      }),
    ).rejects.toThrow(MigrationLockedException);
  });

  it('apiRenameRow should return 423 during active migration', async () => {
    const { draftRevisionId, tableId, rowId } = await prepareProject(prisma);
    await createActiveMigration(draftRevisionId);

    await expect(
      draftApi.apiRenameRow({
        revisionId: draftRevisionId,
        tableId,
        rowId,
        nextRowId: 'renamed-row',
      }),
    ).rejects.toThrow(MigrationLockedException);
  });

  it('apiRenameTable should return 423 during active migration', async () => {
    const { draftRevisionId, tableId } = await prepareProject(prisma);
    await createActiveMigration(draftRevisionId);

    await expect(
      draftApi.apiRenameTable({
        revisionId: draftRevisionId,
        tableId,
        nextTableId: 'renamed-table',
      }),
    ).rejects.toThrow(MigrationLockedException);
  });

  it('MigrationLockedException should have status 423', () => {
    const error = new MigrationLockedException({
      migrationId: 'test',
      tableId: 'table',
      status: 'COPYING',
      progress: { percentage: 50, copiedRows: 500, totalRows: 1000 },
    });

    expect(error.getStatus()).toBe(HttpStatus.LOCKED);
  });
});
