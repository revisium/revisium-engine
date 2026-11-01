import { HeldMigrationLeases } from 'src/features/migration/services/held-migration-leases';
import { MigrationWorkerService } from 'src/features/migration/services/migration-worker.service';
import type { MigrationOptions } from 'src/features/migration/types/migration-options.types';

type WorkerMode = NonNullable<MigrationOptions['workerMode']>;

const POLL_INTERVAL_MS = 1_000;
const STALLED_SWAP = {
  migrationId: 'mig-swapping',
  token: 'stalled-owner',
  lockedAt: new Date(0),
};

describe('MigrationWorkerService', () => {
  describe('startup', () => {
    it.each<WorkerMode>(['inline', 'polling', 'disabled'])(
      'disposes legacy records in %s mode',
      async (workerMode) => {
        const { worker, legacyMigrations } = createWorker(workerMode);

        await worker.onModuleInit();

        expect(legacyMigrations.dispose).toHaveBeenCalledTimes(1);
      },
    );

    it('sweeps only after the legacy records are disposed', async () => {
      const { worker, legacyMigrations, transitions } = createWorker('inline');
      const disposal = deferred<void>();
      legacyMigrations.dispose.mockReturnValue(disposal.promise);

      const startup = worker.onModuleInit();
      await jest.advanceTimersByTimeAsync(3 * POLL_INTERVAL_MS);
      expect(transitions.cancelStalled).not.toHaveBeenCalled();

      disposal.resolve();
      await startup;
      await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      expect(transitions.cancelStalled).toHaveBeenCalledTimes(1);
    });
  });

  describe('recurring sweep', () => {
    it.each<WorkerMode>(['inline', 'polling'])(
      'runs every pollIntervalMs in %s mode',
      async (workerMode) => {
        const { worker, transitions } = createWorker(workerMode);
        await worker.onModuleInit();

        await jest.advanceTimersByTimeAsync(3 * POLL_INTERVAL_MS);

        expect(transitions.cancelStalled).toHaveBeenCalledTimes(3);
      },
    );

    it('never runs in disabled mode', async () => {
      const { worker, transitions } = createWorker('disabled');
      await worker.onModuleInit();

      await jest.advanceTimersByTimeAsync(3 * POLL_INTERVAL_MS);

      expect(transitions.cancelStalled).not.toHaveBeenCalled();
    });

    it('cancels stalled migrations and looks for stalled swaps before it claims the oldest abandoned migration', async () => {
      const { worker, transitions, migrationService } = createWorker('polling');
      transitions.findOldestClaimable.mockResolvedValueOnce('mig-abandoned');
      await worker.onModuleInit();

      await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

      expect(migrationService.processMigration).toHaveBeenCalledWith(
        'mig-abandoned',
      );
      expect(callOrderOf(transitions.cancelStalled)).toBeLessThan(
        callOrderOf(transitions.findStalledSwaps),
      );
      expect(callOrderOf(transitions.findStalledSwaps)).toBeLessThan(
        callOrderOf(transitions.findOldestClaimable),
      );
    });

    it('drives every stalled swap it takes over', async () => {
      const { worker, transitions, migrationService } = createWorker('polling');
      const otherStalledSwap = { ...STALLED_SWAP, migrationId: 'mig-other' };
      transitions.findStalledSwaps.mockResolvedValueOnce([
        STALLED_SWAP,
        otherStalledSwap,
      ]);
      await worker.onModuleInit();

      await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

      expect(migrationService.takeOverStalledSwap.mock.calls).toEqual([
        [STALLED_SWAP],
        [otherStalledSwap],
      ]);
    });

    it('keeps cancelling and taking over while it owns a migration, and claims no other', async () => {
      const worker = createWorker('polling');
      worker.transitions.findOldestClaimable.mockResolvedValue('mig-abandoned');
      driveWithoutEnd(worker);
      await worker.worker.onModuleInit();

      await jest.advanceTimersByTimeAsync(3 * POLL_INTERVAL_MS);

      expect(worker.transitions.cancelStalled).toHaveBeenCalledTimes(3);
      expect(worker.transitions.findStalledSwaps).toHaveBeenCalledTimes(3);
      expect(worker.transitions.findOldestClaimable).toHaveBeenCalledTimes(1);
      expect(worker.migrationService.processMigration).toHaveBeenCalledTimes(1);
    });

    it('claims the next migration once the one it still drives is no longer owned', async () => {
      const worker = createWorker('polling');
      worker.transitions.findOldestClaimable
        .mockResolvedValueOnce('mig-suspended')
        .mockResolvedValueOnce('mig-next');
      driveWithoutEnd(worker);
      await worker.worker.onModuleInit();
      await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

      worker.transitions.findStillOwned.mockResolvedValue([]);
      await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

      expect(worker.migrationService.processMigration.mock.calls).toEqual([
        ['mig-suspended'],
        ['mig-next'],
      ]);
      expect(worker.heldLeases.list()).toEqual([
        { migrationId: 'mig-next', token: 'mig-next-owner' },
      ]);
    });

    it('sweeps again on the next tick after a failed sweep', async () => {
      const { worker, transitions } = createWorker('polling');
      transitions.cancelStalled.mockRejectedValueOnce(
        new Error('connection lost'),
      );
      await worker.onModuleInit();

      await jest.advanceTimersByTimeAsync(2 * POLL_INTERVAL_MS);

      expect(transitions.findOldestClaimable).toHaveBeenCalledTimes(1);
    });
  });

  describe('triggerInline', () => {
    it('drives the started migration in inline mode', async () => {
      const { worker, migrationService } = createWorker('inline');

      await worker.triggerInline('mig-started');

      expect(migrationService.processMigration).toHaveBeenCalledWith(
        'mig-started',
      );
    });

    it.each<WorkerMode>(['polling', 'disabled'])(
      'leaves the started migration to its owner in %s mode',
      async (workerMode) => {
        const { worker, migrationService } = createWorker(workerMode);

        await worker.triggerInline('mig-started');

        expect(migrationService.processMigration).not.toHaveBeenCalled();
      },
    );
  });

  describe('shutdown', () => {
    it('stops sweeping and waits for the migrations it drives', async () => {
      const { worker, transitions, migrationService } = createWorker('inline');
      const drive = deferred<string>();
      migrationService.processMigration.mockReturnValue(drive.promise);
      await worker.onModuleInit();
      await worker.triggerInline('mig-started');

      let isDestroyed = false;
      const destroying = worker.onModuleDestroy().then(() => {
        isDestroyed = true;
      });
      await jest.advanceTimersByTimeAsync(3 * POLL_INTERVAL_MS);
      expect(isDestroyed).toBe(false);

      drive.resolve('completed');
      await destroying;
      expect(transitions.cancelStalled).not.toHaveBeenCalled();
    });

    it('completes after a migration it drives fails', async () => {
      const { worker, migrationService } = createWorker('inline');
      migrationService.processMigration.mockRejectedValue(
        new Error('processing failed'),
      );
      await worker.triggerInline('mig-started');

      await expect(worker.onModuleDestroy()).resolves.toBeUndefined();
    });
  });

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });
});

function createWorker(workerMode: WorkerMode) {
  const migrationService = {
    processMigration: jest.fn().mockResolvedValue('completed'),
    takeOverStalledSwap: jest.fn().mockResolvedValue('completed'),
  };
  const transitions = {
    cancelStalled: jest.fn().mockResolvedValue(0),
    findStalledSwaps: jest.fn().mockResolvedValue([]),
    findStillOwned: jest.fn((leases: unknown[]) => Promise.resolve(leases)),
    findOldestClaimable: jest.fn().mockResolvedValue(null),
  };
  const legacyMigrations = {
    dispose: jest.fn().mockResolvedValue(undefined),
  };
  const heldLeases = new HeldMigrationLeases();
  const worker = new MigrationWorkerService(
    migrationService as never,
    transitions as never,
    legacyMigrations as never,
    heldLeases,
    { workerMode, pollIntervalMs: POLL_INTERVAL_MS },
  );

  return {
    worker,
    migrationService,
    transitions,
    legacyMigrations,
    heldLeases,
  };
}

function driveWithoutEnd({
  migrationService,
  heldLeases,
}: ReturnType<typeof createWorker>): void {
  migrationService.processMigration.mockImplementation((migrationId) => {
    heldLeases.hold({ migrationId, token: `${migrationId}-owner` });

    return deferred<string>().promise;
  });
}

function callOrderOf(mock: jest.Mock): number {
  const [order] = mock.mock.invocationCallOrder;

  if (order === undefined) {
    throw new Error('The sweep step was not called');
  }

  return order;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
}
