import type { MigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';
import { createMigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';
import { prepareBranch } from 'src/__tests__/utils/prepareProject';
import { MigrationLockedException } from 'src/features/migration/exceptions/migration-locked.exception';
import { MigrationStatus } from 'src/features/migration/types/migration.types';
import { createMigrationRecord } from './support/migration-database';

describe('MigrationLockService', () => {
  let kit: MigrationTestKit;

  beforeAll(async () => {
    kit = await createMigrationTestKit();
  });

  afterAll(async () => {
    if (kit) {
      await kit.close();
    }
  });

  describe('checkRevisionLock', () => {
    it('should not throw when no active migration exists', async () => {
      const { draftRevisionId } = await prepareBranch(kit.prisma);
      await expect(
        kit.migrationLockService.checkRevisionLock(draftRevisionId),
      ).resolves.toBeUndefined();
    });

    it('should throw MigrationLockedException when PENDING migration exists', async () => {
      const { draftRevisionId } = await prepareBranch(kit.prisma);

      await createMigrationRecord(
        kit.prisma,
        draftRevisionId,
        MigrationStatus.PENDING,
        { tableId: 'test-table', phase: 'INIT', totalRows: 500 },
      );

      await expect(
        kit.migrationLockService.checkRevisionLock(draftRevisionId),
      ).rejects.toThrow(MigrationLockedException);
    });

    it('should throw MigrationLockedException when COPYING migration exists', async () => {
      const { draftRevisionId } = await prepareBranch(kit.prisma);

      await createMigrationRecord(
        kit.prisma,
        draftRevisionId,
        MigrationStatus.COPYING,
        {
          tableId: 'test-table',
          phase: 'COPYING',
          totalRows: 1000,
          copiedRows: 300,
        },
      );

      const error = await kit.migrationLockService
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
      const { draftRevisionId } = await prepareBranch(kit.prisma);

      await createMigrationRecord(
        kit.prisma,
        draftRevisionId,
        MigrationStatus.COMPLETED,
        {
          tableId: 'test-table',
          phase: 'DONE',
          totalRows: 500,
          copiedRows: 500,
        },
      );

      await expect(
        kit.migrationLockService.checkRevisionLock(draftRevisionId),
      ).resolves.toBeUndefined();
    });

    it('should not throw when only CANCELLED migration exists', async () => {
      const { draftRevisionId } = await prepareBranch(kit.prisma);

      await createMigrationRecord(
        kit.prisma,
        draftRevisionId,
        MigrationStatus.CANCELLED,
        { tableId: 'test-table', phase: 'COPYING', totalRows: 500 },
      );

      await expect(
        kit.migrationLockService.checkRevisionLock(draftRevisionId),
      ).resolves.toBeUndefined();
    });
  });

  describe('checkBranchLock', () => {
    it('should not throw when no active migration exists for draft revision', async () => {
      const { projectId, branchName } = await prepareBranch(kit.prisma);

      await expect(
        kit.migrationLockService.checkBranchLock(projectId, branchName),
      ).resolves.toBeUndefined();
    });

    it('should throw MigrationLockedException when draft revision has active migration', async () => {
      const { projectId, branchName, draftRevisionId } = await prepareBranch(
        kit.prisma,
      );

      await createMigrationRecord(
        kit.prisma,
        draftRevisionId,
        MigrationStatus.SWAPPING,
        { tableId: 'test-table', phase: 'SWAPPING', totalRows: 500 },
      );

      await expect(
        kit.migrationLockService.checkBranchLock(projectId, branchName),
      ).rejects.toThrow(MigrationLockedException);
    });
  });
});
