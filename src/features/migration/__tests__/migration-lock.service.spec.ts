import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { MigrationLockService } from 'src/features/migration/services/migration-lock.service';
import { MigrationLockedException } from 'src/features/migration/exceptions/migration-locked.exception';
import { MigrationStatus } from 'src/features/migration/types/migration.types';
import { prepareBranch } from 'src/__tests__/utils/prepareProject';

describe('MigrationLockService', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let lockService: MigrationLockService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        DatabaseModule,
        CqrsModule,
      ],
      providers: [MigrationLockService],
    }).compile();

    await module.init();
    prisma = module.get(PrismaService);
    lockService = module.get(MigrationLockService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('checkRevisionLock', () => {
    it('should not throw when no active migration exists', async () => {
      const { draftRevisionId } = await prepareBranch(prisma);
      await expect(
        lockService.checkRevisionLock(draftRevisionId),
      ).resolves.toBeUndefined();
    });

    it('should throw MigrationLockedException when PENDING migration exists', async () => {
      const { draftRevisionId } = await prepareBranch(prisma);

      await prisma.tableMigration.create({
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

      await expect(
        lockService.checkRevisionLock(draftRevisionId),
      ).rejects.toThrow(MigrationLockedException);
    });

    it('should throw MigrationLockedException when COPYING migration exists', async () => {
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

      const error = await lockService
        .checkRevisionLock(draftRevisionId)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(MigrationLockedException);
      const locked = error as MigrationLockedException;
      const response = locked.getResponse() as Record<string, unknown>;
      const migration = response.migration as Record<string, unknown>;
      const progress = migration.progress as Record<string, unknown>;
      expect(progress.copiedRows).toBe(300);
      expect(progress.totalRows).toBe(1000);
      expect(progress.percentage).toBe(30);
    });

    it('should not throw when only COMPLETED migration exists', async () => {
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
        lockService.checkRevisionLock(draftRevisionId),
      ).resolves.toBeUndefined();
    });

    it('should not throw when only CANCELLED migration exists', async () => {
      const { draftRevisionId } = await prepareBranch(prisma);

      await prisma.tableMigration.create({
        data: {
          revisionId: draftRevisionId,
          tableId: 'test-table',
          sourceTableVersionId: 'source-v1',
          status: MigrationStatus.CANCELLED,
          phase: 'COPYING',
          patches: [],
          previousSchema: {},
          previousSchemaHash: 'hash1',
          targetSchemaHash: 'hash2',
          totalRows: 500,
        },
      });

      await expect(
        lockService.checkRevisionLock(draftRevisionId),
      ).resolves.toBeUndefined();
    });
  });

  describe('checkBranchLock', () => {
    it('should not throw when no active migration exists for draft revision', async () => {
      const { projectId, branchName } = await prepareBranch(prisma);

      await expect(
        lockService.checkBranchLock(projectId, branchName),
      ).resolves.toBeUndefined();
    });

    it('should throw MigrationLockedException when draft revision has active migration', async () => {
      const { projectId, branchName, draftRevisionId } =
        await prepareBranch(prisma);

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
        lockService.checkBranchLock(projectId, branchName),
      ).rejects.toThrow(MigrationLockedException);
    });
  });
});
