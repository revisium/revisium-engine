import { MigrationWorkerService } from 'src/features/migration/services/migration-worker.service';
import { MigrationStatus } from 'src/features/migration/types/migration.types';

function createMockPrisma() {
  return {
    tableMigration: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

function createMockMigrationService() {
  return {
    processMigration: jest.fn().mockResolvedValue('completed'),
  };
}

function createMockTransitions() {
  return {
    findClaimable: jest.fn().mockResolvedValue([]),
  };
}

function createWorker(
  overrides: {
    workerMode?: 'inline' | 'polling' | 'disabled';
    prisma?: ReturnType<typeof createMockPrisma>;
    migrationService?: ReturnType<typeof createMockMigrationService>;
    transitions?: ReturnType<typeof createMockTransitions>;
  } = {},
) {
  const prisma = overrides.prisma ?? createMockPrisma();
  const migrationService =
    overrides.migrationService ?? createMockMigrationService();
  const transitions = overrides.transitions ?? createMockTransitions();

  const worker = new MigrationWorkerService(
    prisma as never,
    migrationService as never,
    transitions as never,
    {
      workerMode: overrides.workerMode ?? 'inline',
      pollIntervalMs: 100_000,
      lockTimeoutMs: 1000,
      stallTimeoutMs: 1000,
    },
  );

  return { worker, prisma, migrationService, transitions };
}

function pollForWork(worker: MigrationWorkerService): Promise<void> {
  return (
    worker as unknown as { pollForWork: () => Promise<void> }
  ).pollForWork();
}

describe('MigrationWorkerService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (
      MigrationWorkerService as unknown as {
        inlineRecoveryPromise?: Promise<void>;
      }
    ).inlineRecoveryPromise = undefined;
  });

  describe('triggerInline', () => {
    it('should process the migration in inline mode', async () => {
      const { worker, migrationService } = createWorker({
        workerMode: 'inline',
      });

      await worker.triggerInline('mig-1');
      await worker.onModuleDestroy();

      expect(migrationService.processMigration).toHaveBeenCalledWith('mig-1');
    });

    it('should not process the migration in disabled mode', async () => {
      const { worker, migrationService } = createWorker({
        workerMode: 'disabled',
      });

      await worker.triggerInline('mig-1');
      await worker.onModuleDestroy();

      expect(migrationService.processMigration).not.toHaveBeenCalled();
    });

    it('should not process the migration in polling mode', async () => {
      const { worker, migrationService } = createWorker({
        workerMode: 'polling',
      });

      await worker.triggerInline('mig-1');
      await worker.onModuleDestroy();

      expect(migrationService.processMigration).not.toHaveBeenCalled();
    });

    it('should catch errors from inline processing', async () => {
      const migrationService = createMockMigrationService();
      migrationService.processMigration.mockRejectedValue(
        new Error('processing failed'),
      );
      const { worker } = createWorker({
        workerMode: 'inline',
        migrationService,
      });

      await worker.triggerInline('mig-1');

      await expect(worker.onModuleDestroy()).resolves.toBeUndefined();
      expect(migrationService.processMigration).toHaveBeenCalled();
    });
  });

  describe('onModuleInit', () => {
    it('should resume claimable migrations in created-at order in inline mode', async () => {
      const transitions = createMockTransitions();
      transitions.findClaimable.mockResolvedValue([
        'mig-pending',
        'mig-copying',
      ]);
      const { worker, migrationService } = createWorker({
        workerMode: 'inline',
        transitions,
      });

      await worker.onModuleInit();

      expect(migrationService.processMigration).toHaveBeenNthCalledWith(
        1,
        'mig-pending',
      );
      expect(migrationService.processMigration).toHaveBeenNthCalledWith(
        2,
        'mig-copying',
      );
    });

    it('should only run inline recovery once per process', async () => {
      const firstTransitions = createMockTransitions();
      firstTransitions.findClaimable.mockResolvedValue(['mig-first']);
      const first = createWorker({
        workerMode: 'inline',
        transitions: firstTransitions,
      });
      const second = createWorker({ workerMode: 'inline' });

      await first.worker.onModuleInit();
      await second.worker.onModuleInit();

      expect(first.migrationService.processMigration).toHaveBeenCalledWith(
        'mig-first',
      );
      expect(second.transitions.findClaimable).not.toHaveBeenCalled();
      expect(second.migrationService.processMigration).not.toHaveBeenCalled();
    });

    it('should not resume migrations at init in polling mode', async () => {
      const { worker, transitions } = createWorker({ workerMode: 'polling' });

      await worker.onModuleInit();
      await worker.onModuleDestroy();

      expect(transitions.findClaimable).not.toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy', () => {
    it('should wait for active processing', async () => {
      const migrationService = createMockMigrationService();
      let finishProcessing!: () => void;
      migrationService.processMigration.mockReturnValue(
        new Promise<string>((resolve) => {
          finishProcessing = () => resolve('completed');
        }),
      );
      const { worker } = createWorker({
        workerMode: 'inline',
        migrationService,
      });
      await worker.triggerInline('mig-active');
      let destroyed = false;

      const destroying = worker.onModuleDestroy().then(() => {
        destroyed = true;
      });
      await Promise.resolve();
      expect(destroyed).toBe(false);

      finishProcessing();
      await destroying;
      expect(destroyed).toBe(true);
    });
  });

  describe('pollForWork', () => {
    it('should process the oldest claimable migration', async () => {
      const transitions = createMockTransitions();
      transitions.findClaimable.mockResolvedValue(['mig-pending']);
      const { worker, migrationService } = createWorker({
        workerMode: 'polling',
        transitions,
      });

      await pollForWork(worker);

      expect(transitions.findClaimable).toHaveBeenCalledWith(1);
      expect(migrationService.processMigration).toHaveBeenCalledWith(
        'mig-pending',
      );
    });

    it('should skip polling when shutting down', async () => {
      const { worker, transitions } = createWorker({ workerMode: 'polling' });

      await worker.onModuleDestroy();
      await pollForWork(worker);

      expect(transitions.findClaimable).not.toHaveBeenCalled();
    });

    it('should skip polling while a migration is processed', async () => {
      const { worker, transitions } = createWorker({ workerMode: 'polling' });
      (worker as unknown as { activeMigrationId: string }).activeMigrationId =
        'busy';

      await pollForWork(worker);

      expect(transitions.findClaimable).not.toHaveBeenCalled();
    });

    it('should handle a processing failure gracefully', async () => {
      const migrationService = createMockMigrationService();
      migrationService.processMigration.mockRejectedValue(new Error('boom'));
      const transitions = createMockTransitions();
      transitions.findClaimable.mockResolvedValue(['mig-fail']);
      const { worker } = createWorker({
        workerMode: 'polling',
        migrationService,
        transitions,
      });

      await expect(pollForWork(worker)).resolves.toBeUndefined();
      expect(migrationService.processMigration).toHaveBeenCalledWith(
        'mig-fail',
      );
    });
  });

  describe('autoAbortStalledMigrations', () => {
    it('should cancel stalled migrations atomically', async () => {
      const prisma = createMockPrisma();
      prisma.tableMigration.updateMany.mockResolvedValue({ count: 2 });
      const { worker } = createWorker({ workerMode: 'polling', prisma });

      await pollForWork(worker);

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
    });
  });
});
