import { MigrationProgressService } from 'src/features/migration/services/migration-progress.service';
import {
  MigrationPhase,
  MigrationStatus,
} from 'src/features/migration/types/migration.types';

function createMockPrisma() {
  return {
    tableMigration: {
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
    },
  };
}

function createService(prisma = createMockPrisma()) {
  return {
    service: new MigrationProgressService(prisma as never),
    prisma,
  };
}

describe('MigrationProgressService', () => {
  describe('updateProgress', () => {
    it('should update copiedRows, lastCopiedRowId, currentBatch', async () => {
      const { service, prisma } = createService();

      await service.updateProgress('mig-1', {
        copiedRows: 500,
        lastCopiedRowId: 'row-500',
        currentBatch: 5,
      });

      expect(prisma.tableMigration.update).toHaveBeenCalledWith({
        where: { id: 'mig-1' },
        data: {
          copiedRows: 500,
          lastCopiedRowId: 'row-500',
          currentBatch: 5,
          lastProgressAt: expect.any(Date),
        },
      });
    });
  });

  describe('setPhase', () => {
    it('should set phase without status', async () => {
      const { service, prisma } = createService();

      await service.setPhase('mig-1', MigrationPhase.VALIDATING);

      expect(prisma.tableMigration.update).toHaveBeenCalledWith({
        where: { id: 'mig-1' },
        data: {
          phase: MigrationPhase.VALIDATING,
          lastProgressAt: expect.any(Date),
        },
      });
    });

    it('should set phase and status together', async () => {
      const { service, prisma } = createService();

      await service.setPhase(
        'mig-1',
        MigrationPhase.COPYING,
        MigrationStatus.COPYING,
      );

      expect(prisma.tableMigration.update).toHaveBeenCalledWith({
        where: { id: 'mig-1' },
        data: expect.objectContaining({
          phase: MigrationPhase.COPYING,
          status: MigrationStatus.COPYING,
          startedAt: expect.any(Date),
        }),
      });
    });

    it('should set completedAt when phase is DONE', async () => {
      const { service, prisma } = createService();

      await service.setPhase(
        'mig-1',
        MigrationPhase.DONE,
        MigrationStatus.COMPLETED,
      );

      expect(prisma.tableMigration.update).toHaveBeenCalledWith({
        where: { id: 'mig-1' },
        data: expect.objectContaining({
          phase: MigrationPhase.DONE,
          status: MigrationStatus.COMPLETED,
          completedAt: expect.any(Date),
        }),
      });
    });
  });

  describe('setShadowTableVersionId', () => {
    it('should update shadowTableVersionId', async () => {
      const { service, prisma } = createService();

      await service.setShadowTableVersionId('mig-1', 'shadow-v1');

      expect(prisma.tableMigration.update).toHaveBeenCalledWith({
        where: { id: 'mig-1' },
        data: { shadowTableVersionId: 'shadow-v1' },
      });
    });
  });

  describe('setFailed', () => {
    it('should set FAILED status with error message', async () => {
      const { service, prisma } = createService();

      await service.setFailed('mig-1', 'something went wrong');

      expect(prisma.tableMigration.update).toHaveBeenCalledWith({
        where: { id: 'mig-1' },
        data: {
          status: MigrationStatus.FAILED,
          errorMessage: 'something went wrong',
          completedAt: expect.any(Date),
          lastProgressAt: expect.any(Date),
        },
      });
    });
  });

  describe('incrementRetry', () => {
    it('should increment retryCount and reset to PENDING/INIT', async () => {
      const { service, prisma } = createService();

      await service.incrementRetry('mig-1');

      expect(prisma.tableMigration.update).toHaveBeenCalledWith({
        where: { id: 'mig-1' },
        data: {
          retryCount: { increment: 1 },
          status: MigrationStatus.PENDING,
          phase: MigrationPhase.INIT,
          errorMessage: null,
          completedAt: null,
          lastProgressAt: expect.any(Date),
        },
      });
    });
  });

  describe('isCancelled', () => {
    it('should return true when status is CANCELLED', async () => {
      const prisma = createMockPrisma();
      prisma.tableMigration.findUnique.mockResolvedValue({
        status: MigrationStatus.CANCELLED,
      });
      const { service } = createService(prisma);

      const result = await service.isCancelled('mig-1');
      expect(result).toBe(true);
    });

    it('should return false when status is COPYING', async () => {
      const prisma = createMockPrisma();
      prisma.tableMigration.findUnique.mockResolvedValue({
        status: MigrationStatus.COPYING,
      });
      const { service } = createService(prisma);

      const result = await service.isCancelled('mig-1');
      expect(result).toBe(false);
    });

    it('should return true when migration not found (deleted = cancelled)', async () => {
      const prisma = createMockPrisma();
      prisma.tableMigration.findUnique.mockResolvedValue(null);
      const { service } = createService(prisma);

      const result = await service.isCancelled('mig-1');
      expect(result).toBe(true);
    });
  });
});
