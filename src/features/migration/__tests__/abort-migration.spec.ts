import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { CqrsModule, CommandBus } from '@nestjs/cqrs';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { STORAGE_SERVICE } from 'src/infrastructure/storage/storage.interface';
import { StorageModule } from 'src/infrastructure/storage/storage.module';
import { MigrationModule } from 'src/features/migration/migration.module';
import { AbortMigrationCommand } from 'src/features/migration/commands/impl/abort-migration.command';
import { MigrationStatus } from 'src/features/migration/types/migration.types';
import { prepareBranch } from 'src/__tests__/utils/prepareProject';

const mockStorage = {
  isAvailable: true,
  canServeFiles: false,
  uploadFile: jest.fn().mockResolvedValue({ key: 'uploads/fake.png' }),
  getPublicUrl: jest.fn((key: string) => `http://test-files/${key}`),
};

describe('AbortMigrationHandler', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let commandBus: CommandBus;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        DatabaseModule,
        CqrsModule,
        StorageModule.forRoot(),
        MigrationModule.forRoot(),
      ],
    })
      .overrideProvider(STORAGE_SERVICE)
      .useValue(mockStorage)
      .compile();

    await module.init();
    prisma = module.get(PrismaService);
    commandBus = module.get(CommandBus);
  });

  afterAll(async () => {
    await module.close();
  });

  it('should cancel a PENDING migration', async () => {
    const { draftRevisionId } = await prepareBranch(prisma);

    const migration = await prisma.tableMigration.create({
      data: {
        revisionId: draftRevisionId,
        tableId: 'test-table',
        sourceTableVersionId: 'source-v1',
        status: MigrationStatus.PENDING,
        phase: 'INIT',
        patches: [],
        previousSchema: {},
        previousSchemaHash: 'hash1',
        targetSchemaHash: 'hash2',
        totalRows: 500,
      },
    });

    await commandBus.execute(
      new AbortMigrationCommand({
        revisionId: draftRevisionId,
        tableId: 'test-table',
      }),
    );

    const updated = await prisma.tableMigration.findUnique({
      where: {
        revisionId_tableId: {
          revisionId: migration.revisionId,
          tableId: migration.tableId,
        },
      },
    });
    expect(updated).toBeNull();
  });

  it('should cancel a COPYING migration', async () => {
    const { draftRevisionId } = await prepareBranch(prisma);

    await prisma.tableMigration.create({
      data: {
        revisionId: draftRevisionId,
        tableId: 'test-table',
        sourceTableVersionId: 'source-v1',
        status: MigrationStatus.COPYING,
        phase: 'COPYING',
        patches: [],
        previousSchema: {},
        previousSchemaHash: 'hash1',
        targetSchemaHash: 'hash2',
        totalRows: 1000,
        copiedRows: 300,
      },
    });

    await commandBus.execute(
      new AbortMigrationCommand({
        revisionId: draftRevisionId,
        tableId: 'test-table',
      }),
    );

    const updated = await prisma.tableMigration.findUnique({
      where: {
        revisionId_tableId: {
          revisionId: draftRevisionId,
          tableId: 'test-table',
        },
      },
    });
    expect(updated).toBeNull();
  });

  it('should throw error when aborting during SWAPPING phase', async () => {
    const { draftRevisionId } = await prepareBranch(prisma);

    await prisma.tableMigration.create({
      data: {
        revisionId: draftRevisionId,
        tableId: 'test-table',
        sourceTableVersionId: 'source-v1',
        status: MigrationStatus.SWAPPING,
        phase: 'SWAPPING',
        patches: [],
        previousSchema: {},
        previousSchemaHash: 'hash1',
        targetSchemaHash: 'hash2',
        totalRows: 500,
      },
    });

    await expect(
      commandBus.execute(
        new AbortMigrationCommand({
          revisionId: draftRevisionId,
          tableId: 'test-table',
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('should throw error when migration is already completed', async () => {
    const { draftRevisionId } = await prepareBranch(prisma);

    await prisma.tableMigration.create({
      data: {
        revisionId: draftRevisionId,
        tableId: 'test-table',
        sourceTableVersionId: 'source-v1',
        status: MigrationStatus.COMPLETED,
        phase: 'DONE',
        patches: [],
        previousSchema: {},
        previousSchemaHash: 'hash1',
        targetSchemaHash: 'hash2',
        totalRows: 500,
        copiedRows: 500,
      },
    });

    await expect(
      commandBus.execute(
        new AbortMigrationCommand({
          revisionId: draftRevisionId,
          tableId: 'test-table',
        }),
      ),
    ).rejects.toThrow(/already completed/);
  });

  it('should return without error when no migration exists', async () => {
    const { draftRevisionId } = await prepareBranch(prisma);

    await expect(
      commandBus.execute(
        new AbortMigrationCommand({
          revisionId: draftRevisionId,
          tableId: 'nonexistent-table',
        }),
      ),
    ).resolves.toBeUndefined();
  });
});
