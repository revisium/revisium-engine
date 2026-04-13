import { MigrationWorkerService } from 'src/features/migration/services/migration-worker.service';
import { MigrationStatus } from 'src/features/migration/types/migration.types';

function createMockPrisma() {
  return {
    tableMigration: {
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({
        id: 'mig-1',
        sourceTableVersionId: 'table-version-id',
      }),
    },
    table: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ versionId: 'table-version-id' }),
    },
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
  };
}

function createMockMigrationService() {
  return {
    processMigration: jest.fn().mockResolvedValue(undefined),
  };
}

function createMockProgressService() {
  return {
    setFailed: jest.fn().mockResolvedValue(undefined),
  };
}

function createWorker(
  overrides: {
    workerMode?: 'inline' | 'polling' | 'disabled';
    pollIntervalMs?: number;
    heartbeatIntervalMs?: number;
    lockTimeoutMs?: number;
    stallTimeoutMs?: number;
    prisma?: ReturnType<typeof createMockPrisma>;
    migrationService?: ReturnType<typeof createMockMigrationService>;
  } = {},
) {
  const prisma = overrides.prisma ?? createMockPrisma();
  const migrationService =
    overrides.migrationService ?? createMockMigrationService();
  const progressService = createMockProgressService();

  const worker = new MigrationWorkerService(
    prisma as never,
    migrationService as never,
    progressService as never,
    {
      workerMode: overrides.workerMode ?? 'inline',
      pollIntervalMs: overrides.pollIntervalMs ?? 50,
      heartbeatIntervalMs: overrides.heartbeatIntervalMs ?? 50,
      lockTimeoutMs: overrides.lockTimeoutMs ?? 1000,
      stallTimeoutMs: overrides.stallTimeoutMs ?? 1000,
    },
  );

  return { worker, prisma, migrationService, progressService };
}

describe('MigrationWorkerService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    (
      MigrationWorkerService as unknown as {
        inlineRecoveryPromise?: Promise<void>;
      }
    ).inlineRecoveryPromise = undefined;
  });

  describe('triggerInline', () => {
    it('should call processMigration in inline mode', async () => {
      const { worker, migrationService, prisma } = createWorker({
        workerMode: 'inline',
      });
      prisma.tableMigration.updateMany.mockResolvedValue({ count: 1 });

      await worker.triggerInline('mig-1');

      // processMigration is fire-and-forget, give it a tick
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(migrationService.processMigration).toHaveBeenCalledWith('mig-1');
    });

    it('should not call processMigration in disabled mode', async () => {
      const { worker, migrationService } = createWorker({
        workerMode: 'disabled',
      });

      await worker.triggerInline('mig-1');
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(migrationService.processMigration).not.toHaveBeenCalled();
    });

    it('should not call processMigration in polling mode', async () => {
      const { worker, migrationService } = createWorker({
        workerMode: 'polling',
      });

      await worker.triggerInline('mig-1');
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(migrationService.processMigration).not.toHaveBeenCalled();
    });

    it('should catch and log errors from inline processMigration', async () => {
      const migrationService = createMockMigrationService();
      migrationService.processMigration.mockRejectedValue(
        new Error('processing failed'),
      );
      const { worker, prisma } = createWorker({
        workerMode: 'inline',
        migrationService,
      });
      prisma.tableMigration.updateMany.mockResolvedValue({ count: 1 });

      await worker.triggerInline('mig-1');
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(migrationService.processMigration).toHaveBeenCalled();
      // Error is caught and logged, does not propagate
    });
  });

  describe('onModuleInit (polling mode)', () => {
    it('should release stale locks on init', async () => {
      const prisma = createMockPrisma();
      prisma.tableMigration.updateMany.mockResolvedValue({ count: 2 });
      const { worker } = createWorker({ workerMode: 'polling', prisma });

      await worker.onModuleInit();

      expect(prisma.tableMigration.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            lockedBy: { not: null },
          }),
          data: { lockedBy: null, lockedAt: null },
        }),
      );

      await worker.onModuleDestroy();
    });

    it('should not start polling in inline mode', async () => {
      const prisma = createMockPrisma();
      const { worker } = createWorker({ workerMode: 'inline', prisma });

      await worker.onModuleInit();

      expect(prisma.tableMigration.updateMany).not.toHaveBeenCalled();
    });

    it('should resume active migrations on init in inline mode', async () => {
      const prisma = createMockPrisma();
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ id: 'mig-pending' }])
        .mockResolvedValueOnce([{ id: 'mig-copying' }])
        .mockResolvedValueOnce([]);
      prisma.tableMigration.findUnique
        .mockResolvedValueOnce({
          id: 'mig-pending',
          sourceTableVersionId: 'source-1',
        })
        .mockResolvedValueOnce({
          id: 'mig-copying',
          sourceTableVersionId: 'source-2',
        });
      const { worker, migrationService } = createWorker({
        workerMode: 'inline',
        prisma,
      });

      await worker.onModuleInit();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(migrationService.processMigration).toHaveBeenNthCalledWith(
        1,
        'mig-pending',
      );
      expect(migrationService.processMigration).toHaveBeenNthCalledWith(
        2,
        'mig-copying',
      );
      expect(prisma.tableMigration.updateMany).not.toHaveBeenCalled();
    });

    it('should fail orphaned active migrations on init in inline mode', async () => {
      const prisma = createMockPrisma();
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ id: 'mig-orphaned' }])
        .mockResolvedValueOnce([]);
      prisma.tableMigration.findUnique.mockResolvedValue({
        id: 'mig-orphaned',
        sourceTableVersionId: 'missing-source',
      });
      prisma.table.findUnique.mockResolvedValue(null);
      const { worker, migrationService, progressService } = createWorker({
        workerMode: 'inline',
        prisma,
      });

      await worker.onModuleInit();

      expect(progressService.setFailed).toHaveBeenCalledWith(
        'mig-orphaned',
        'Recovery aborted: source table not found for active migration',
      );
      expect(migrationService.processMigration).not.toHaveBeenCalled();
    });

    it('should only run inline recovery once per process', async () => {
      const firstPrisma = createMockPrisma();
      firstPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ id: 'mig-first' }])
        .mockResolvedValueOnce([]);
      firstPrisma.tableMigration.findUnique.mockResolvedValue({
        id: 'mig-first',
        sourceTableVersionId: 'source-1',
      });
      const secondPrisma = createMockPrisma();
      const first = createWorker({ workerMode: 'inline', prisma: firstPrisma });
      const second = createWorker({
        workerMode: 'inline',
        prisma: secondPrisma,
      });

      await first.worker.onModuleInit();
      await second.worker.onModuleInit();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(firstPrisma.$queryRawUnsafe).toHaveBeenCalled();
      expect(secondPrisma.$queryRawUnsafe).not.toHaveBeenCalled();
      expect(first.migrationService.processMigration).toHaveBeenCalledWith(
        'mig-first',
      );
      expect(second.migrationService.processMigration).not.toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy', () => {
    it('should wait for active processing on destroy instead of releasing directly', async () => {
      const prisma = createMockPrisma();
      const { worker } = createWorker({
        workerMode: 'polling',
        prisma,
        pollIntervalMs: 100_000,
      });
      let releaseProcessing: (() => void) | undefined;
      const activeProcessingPromise = new Promise<void>((resolve) => {
        releaseProcessing = resolve;
      });

      (worker as unknown as { activeMigrationId: string }).activeMigrationId =
        'mig-active';
      (
        worker as unknown as {
          activeProcessingPromise?: Promise<void>;
        }
      ).activeProcessingPromise = activeProcessingPromise;

      const destroyPromise = worker.onModuleDestroy();

      expect(prisma.tableMigration.update).not.toHaveBeenCalled();
      releaseProcessing?.();
      await destroyPromise;

      expect(prisma.tableMigration.update).not.toHaveBeenCalled();
    });

    it('should stop polling timer on destroy', async () => {
      const { worker } = createWorker({
        workerMode: 'polling',
        pollIntervalMs: 100_000,
      });

      await worker.onModuleInit();
      await worker.onModuleDestroy();

      // No error means timers were cleaned up
    });
  });

  describe('pollForWork', () => {
    it('should acquire and process a pending migration', async () => {
      const prisma = createMockPrisma();
      const migrationService = createMockMigrationService();

      prisma.$queryRawUnsafe.mockResolvedValueOnce([{ id: 'mig-pending' }]);
      prisma.tableMigration.findUnique.mockResolvedValueOnce({
        id: 'mig-pending',
        sourceTableVersionId: 'source-pending',
      });

      const { worker } = createWorker({
        workerMode: 'polling',
        prisma,
        migrationService,
        pollIntervalMs: 100_000,
      });

      await worker.onModuleInit();

      // Manually trigger pollForWork
      const pollForWork = (
        worker as unknown as { pollForWork: () => Promise<void> }
      ).pollForWork.bind(worker);
      await pollForWork();

      expect(migrationService.processMigration).toHaveBeenCalledWith(
        'mig-pending',
      );
      // Lock should be released after processing
      expect(prisma.tableMigration.update).toHaveBeenCalledWith({
        where: { id: 'mig-pending' },
        data: { lockedBy: null, lockedAt: null },
      });

      await worker.onModuleDestroy();
    });

    it('should skip polling when shutting down', async () => {
      const prisma = createMockPrisma();
      const migrationService = createMockMigrationService();

      const { worker } = createWorker({
        workerMode: 'polling',
        prisma,
        migrationService,
        pollIntervalMs: 100_000,
      });

      await worker.onModuleInit();
      await worker.onModuleDestroy(); // sets isShuttingDown

      const pollForWork = (
        worker as unknown as { pollForWork: () => Promise<void> }
      ).pollForWork.bind(worker);
      await pollForWork();

      expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('should skip polling when already processing', async () => {
      const prisma = createMockPrisma();

      const { worker } = createWorker({
        workerMode: 'polling',
        prisma,
        pollIntervalMs: 100_000,
      });

      await worker.onModuleInit();

      (worker as unknown as { activeMigrationId: string }).activeMigrationId =
        'busy';

      const pollForWork = (
        worker as unknown as { pollForWork: () => Promise<void> }
      ).pollForWork.bind(worker);
      await pollForWork();

      // Should not try to acquire another
      expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();

      await worker.onModuleDestroy();
    });

    it('should handle processMigration failure gracefully', async () => {
      const prisma = createMockPrisma();
      const migrationService = createMockMigrationService();
      migrationService.processMigration.mockRejectedValue(new Error('boom'));
      prisma.$queryRawUnsafe.mockResolvedValueOnce([{ id: 'mig-fail' }]);
      prisma.tableMigration.findUnique.mockResolvedValueOnce({
        id: 'mig-fail',
        sourceTableVersionId: 'source-fail',
      });

      const { worker } = createWorker({
        workerMode: 'polling',
        prisma,
        migrationService,
        pollIntervalMs: 100_000,
      });

      await worker.onModuleInit();

      const pollForWork = (
        worker as unknown as { pollForWork: () => Promise<void> }
      ).pollForWork.bind(worker);
      await pollForWork();

      // Lock should be released even after failure
      expect(prisma.tableMigration.update).toHaveBeenCalledWith({
        where: { id: 'mig-fail' },
        data: { lockedBy: null, lockedAt: null },
      });

      await worker.onModuleDestroy();
    });
  });

  describe('autoAbortStalledMigrations', () => {
    it('should cancel stalled migrations atomically', async () => {
      const prisma = createMockPrisma();
      prisma.tableMigration.updateMany.mockResolvedValue({ count: 2 });

      const { worker } = createWorker({
        workerMode: 'polling',
        prisma,
        stallTimeoutMs: 1000,
        pollIntervalMs: 100_000,
      });

      await worker.onModuleInit();

      const autoAbort = (
        worker as unknown as {
          autoAbortStalledMigrations: () => Promise<void>;
        }
      ).autoAbortStalledMigrations.bind(worker);
      await autoAbort();

      expect(prisma.tableMigration.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: [MigrationStatus.PENDING, MigrationStatus.COPYING] },
            lastProgressAt: { lt: expect.any(Date) },
            OR: [{ lockedBy: null }, { heartbeatAt: { lt: expect.any(Date) } }],
          }),
          data: expect.objectContaining({
            status: MigrationStatus.CANCELLED,
            errorMessage: expect.stringContaining('Auto-aborted'),
          }),
        }),
      );

      await worker.onModuleDestroy();
    });
  });

  describe('heartbeat', () => {
    it('should start and stop heartbeat timer', async () => {
      jest.useFakeTimers();
      const prisma = createMockPrisma();

      const { worker } = createWorker({
        workerMode: 'polling',
        prisma,
        heartbeatIntervalMs: 100,
        pollIntervalMs: 100_000,
      });

      const startHeartbeat = (
        worker as unknown as {
          startHeartbeat: (id: string) => void;
        }
      ).startHeartbeat.bind(worker);

      const stopHeartbeat = (
        worker as unknown as {
          stopHeartbeat: () => void;
        }
      ).stopHeartbeat.bind(worker);

      startHeartbeat('mig-hb');
      jest.advanceTimersByTime(250);

      expect(prisma.tableMigration.update).toHaveBeenCalledWith({
        where: { id: 'mig-hb' },
        data: { heartbeatAt: expect.any(Date) },
      });

      stopHeartbeat();
      prisma.tableMigration.update.mockClear();

      jest.advanceTimersByTime(250);
      expect(prisma.tableMigration.update).not.toHaveBeenCalled();
    });
  });
});
