import type { MigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';
import { createBarrier, type Barrier } from 'src/__tests__/utils/barrier';
import { MigrationImportService } from 'src/features/migration/services/migration-import.service';
import type {
  MigrationLease,
  OwnershipEpoch,
} from 'src/features/migration/services/migration-transition.service';
import type { MigrationStepResult } from 'src/features/migration/types/migration.types';
import { expireLease } from './migration-database';
import type { ObservedImports } from './migration-imports';
import type { SweepingProcess } from './migration-sweeps';

export interface OwnerHold {
  barrier: Barrier;
}

export interface TransactionHold extends OwnerHold {
  backendPid(): number;
}

export interface PausedOwner {
  lease: MigrationLease;
  continueUntil(hold: OwnerHold): Promise<void>;
  resume(): Promise<MigrationStepResult>;
}

export interface PausedAbort {
  resume(): Promise<void>;
}

export interface PausedOperation<T> {
  resume(): Promise<T>;
}

export interface StoppedRenewals {
  attempted(): Promise<void>;
}

const startedOwners: { holds: OwnerHold[]; result: Promise<unknown> }[] = [];

export function startOwnerUntil(
  kit: MigrationTestKit,
  migrationId: string,
  hold: OwnerHold,
): Promise<PausedOwner> {
  return pauseOwner(
    kit,
    migrationId,
    kit.migrationService.processMigration(migrationId),
    hold,
  );
}

export async function crashOwnerAt(
  kit: MigrationTestKit,
  migrationId: string,
  hold: OwnerHold,
): Promise<void> {
  const result = kit.migrationService.processMigration(migrationId);
  startedOwners.push({ holds: [hold], result });
  await hold.barrier.expectReachedBefore(result);
}

export async function takeOverUntil(
  kit: MigrationTestKit,
  migrationId: string,
  hold: OwnerHold,
): Promise<PausedOwner> {
  const stalledOwner = await observeStalledSwap(kit, migrationId);

  return pauseOwner(
    kit,
    migrationId,
    kit.migrationService.takeOverStalledSwap(stalledOwner),
    hold,
  );
}

export async function sweptUntil(
  process: SweepingProcess,
  migrationId: string,
  hold: OwnerHold,
): Promise<PausedOwner> {
  const { result } = await process.nextRunOf(migrationId);

  return pauseOwner(process.kit, migrationId, result, hold);
}

export async function drivenByImportUntil(
  imports: ObservedImports,
  importing: Promise<unknown>,
  hold: OwnerHold,
): Promise<PausedOwner> {
  const { migrationId, result } = await imports.nextDriverWhile(importing);

  return pauseOwner(imports.kit, migrationId, result, hold);
}

export async function pauseUntil<T>(
  operation: Promise<T>,
  hold: OwnerHold,
): Promise<PausedOperation<T>> {
  startedOwners.push({ holds: [hold], result: operation });
  await hold.barrier.expectReachedBefore(operation);

  return {
    resume() {
      hold.barrier.release();

      return operation;
    },
  };
}

export async function killOwnerProcess(
  process: MigrationTestKit,
  migrationId: string,
  lockTimeoutMs: number,
): Promise<void> {
  const renewals = stopLeaseRenewals(process);
  await expireLease(process.prisma, migrationId, lockTimeoutMs);
  await renewals.attempted();
}

export function stopLeaseRenewals(process: MigrationTestKit): StoppedRenewals {
  let markAttempted!: () => void;
  const attempted = new Promise<void>((resolve) => {
    markAttempted = resolve;
  });

  jest.spyOn(process.migrationTransitions, 'renew').mockImplementation(() => {
    markAttempted();

    return Promise.resolve(false);
  });

  return { attempted: () => attempted };
}

export async function startAbortUntil(
  kit: MigrationTestKit,
  table: { revisionId: string; tableId: string },
  hold: OwnerHold,
): Promise<PausedAbort> {
  const result = kit.migrationApi.abortMigration(table);
  startedOwners.push({ holds: [hold], result });
  await hold.barrier.expectReachedBefore(result);

  return {
    resume() {
      hold.barrier.release();

      return result;
    },
  };
}

export async function observeStalledSwap(
  kit: MigrationTestKit,
  migrationId: string,
): Promise<OwnershipEpoch> {
  const stalledOwner = await findStalledSwapOwner(kit, migrationId);

  if (!stalledOwner) {
    throw new Error(`No observer sees the swap of ${migrationId} stalled`);
  }

  return stalledOwner;
}

export async function findStalledSwapOwner(
  kit: MigrationTestKit,
  migrationId: string,
): Promise<OwnershipEpoch | undefined> {
  const stalledOwners = await kit.migrationTransitions.findStalledSwaps();

  return stalledOwners.find((owner) => owner.migrationId === migrationId);
}

export async function releaseStartedOwners(): Promise<void> {
  const owners = startedOwners.splice(0);

  for (const held of owners.flatMap(({ holds }) => holds)) {
    held.barrier.release();
  }

  await Promise.allSettled(owners.map(({ result }) => result));
}

export async function waitUntilSettledOrBlockedBy(
  kit: MigrationTestKit,
  backendPid: number,
  contending: Promise<unknown>,
): Promise<void> {
  let isSettled = false;
  const markSettled = () => {
    isSettled = true;
  };
  contending.then(markSettled, markSettled);

  while (!(await isBlockedBy(kit, backendPid))) {
    if (isSettled) {
      return;
    }
  }
}

export function beforeCopyStarts(kit: MigrationTestKit): OwnerHold {
  return holdCall(kit.migrationTransitions, 'beginCopy', 1, 'before');
}

export function beforeBatchWrite(
  kit: MigrationTestKit,
  writeNumber: number,
): OwnerHold {
  return holdCall(
    kit.migrationBatchService,
    'writeBatch',
    writeNumber,
    'before',
  );
}

export function beforeRetry(kit: MigrationTestKit): OwnerHold {
  return holdCall(kit.migrationTransitions, 'retry', 1, 'before');
}

export function afterRetry(kit: MigrationTestKit): OwnerHold {
  return holdCall(kit.migrationTransitions, 'retry', 1, 'after');
}

export function beforeActiveImportLookup(kit: MigrationTestKit): OwnerHold {
  return holdCall(importServiceOf(kit), 'findActiveImport', 1, 'before');
}

export function beforeImportAwaits(
  kit: MigrationTestKit,
  awaitedMigration: number,
): OwnerHold {
  return holdCall(
    importServiceOf(kit),
    'driveUntilEnded',
    awaitedMigration,
    'before',
  );
}

export function afterImportAwaited(kit: MigrationTestKit): OwnerHold {
  return holdCall(importServiceOf(kit), 'driveUntilEnded', 1, 'after');
}

export function beforeObservation(
  kit: MigrationTestKit,
  observation: number,
): OwnerHold {
  return holdCall(
    kit.migrationTransitions,
    'cancelIfStalled',
    observation,
    'before',
  );
}

export function beforeSwapBegins(kit: MigrationTestKit): OwnerHold {
  return holdCall(kit.migrationTransitions, 'beginSwap', 1, 'before');
}

export function afterSwapBegins(kit: MigrationTestKit): OwnerHold {
  return holdCall(kit.migrationTransitions, 'beginSwap', 1, 'after');
}

export function afterTakeoverWins(kit: MigrationTestKit): OwnerHold {
  return holdCall(kit.migrationTransitions, 'takeOver', 1, 'after');
}

export function afterClaimableFound(kit: MigrationTestKit): OwnerHold {
  return holdCall(kit.migrationTransitions, 'findOldestClaimable', 1, 'after');
}

export function afterSwapTransactionCommits(kit: MigrationTestKit): OwnerHold {
  return holdCall(kit.transactionService, 'runSerializable', 1, 'after');
}

export function beforeSwapTransaction(
  kit: MigrationTestKit,
  attempt: number,
): OwnerHold {
  return holdCall(kit.transactionService, 'runSerializable', attempt, 'before');
}

export function afterAbortReadsItsRecord(kit: MigrationTestKit): OwnerHold {
  return holdCall(kit.migrationTransitions, 'findByTable', 1, 'after');
}

export function insideSwapAfterItsRecordCheck(
  kit: MigrationTestKit,
): TransactionHold {
  let backendPid = 0;
  const hold = holdCall(
    kit.migrationTransitions,
    'lockSwap',
    1,
    'after',
    async () => {
      backendPid = await readBackendPid(kit);
    },
  );

  return { ...hold, backendPid: () => backendPid };
}

async function pauseOwner(
  kit: MigrationTestKit,
  migrationId: string,
  result: Promise<MigrationStepResult>,
  hold: OwnerHold,
): Promise<PausedOwner> {
  const holds = [hold];
  startedOwners.push({ holds, result });
  await hold.barrier.expectReachedBefore(result);

  return {
    lease: await readLease(kit, migrationId),
    async continueUntil(next) {
      holds.push(next);
      hold.barrier.release();
      await next.barrier.expectReachedBefore(result);
    },
    resume() {
      for (const held of holds) {
        held.barrier.release();
      }

      return result;
    },
  };
}

function importServiceOf(kit: MigrationTestKit): MigrationImportService {
  return kit.module.get(MigrationImportService);
}

async function readBackendPid(kit: MigrationTestKit): Promise<number> {
  const [backend] = await kit.transactionService.getTransaction().$queryRaw<
    { pid: number }[]
  >`SELECT pg_backend_pid() AS pid`;

  return backend?.pid ?? 0;
}

async function isBlockedBy(
  kit: MigrationTestKit,
  backendPid: number,
): Promise<boolean> {
  const blocked = await kit.prisma.$queryRaw<unknown[]>`
    SELECT 1 FROM pg_stat_activity
    WHERE ${backendPid}::int = ANY(pg_blocking_pids(pid))`;

  return blocked.length > 0;
}

async function readLease(
  kit: MigrationTestKit,
  migrationId: string,
): Promise<MigrationLease> {
  const { lockedBy } = await kit.prisma.tableMigration.findUniqueOrThrow({
    where: { id: migrationId },
  });

  if (!lockedBy) {
    throw new Error(`Migration ${migrationId} has no owner`);
  }

  return { migrationId, token: lockedBy };
}

type AsyncMethod = (...args: never[]) => Promise<unknown>;
type HoldTiming = 'before' | 'after';

interface CallHold {
  barrier: Barrier;
  timing: HoldTiming;
  onHold?: () => Promise<void>;
}

interface CallHolds {
  calls: number;
  holds: Map<number, CallHold>;
}

const callHoldsBySpy = new WeakMap<object, CallHolds>();

function holdCall(
  target: object,
  method: string,
  callNumber: number,
  timing: HoldTiming,
  onHold?: () => Promise<void>,
): OwnerHold {
  const barrier = createBarrier(
    `The migration owner at ${method} call ${callNumber}`,
  );
  callHoldsOf(target, method).holds.set(callNumber, {
    barrier,
    timing,
    onHold,
  });

  return { barrier };
}

function callHoldsOf(target: object, method: string): CallHolds {
  const methods = target as Record<string, AsyncMethod>;
  const current = methods[method];

  if (!current) {
    throw new Error(`No method ${method} to hold`);
  }

  const existing = callHoldsBySpy.get(current);

  if (existing) {
    return existing;
  }

  const original = current.bind(target);
  const callHolds: CallHolds = { calls: 0, holds: new Map() };
  jest.spyOn(methods, method).mockImplementation(async (...args) => {
    callHolds.calls += 1;
    const hold = callHolds.holds.get(callHolds.calls);

    if (hold?.timing === 'before') {
      await arriveAt(hold);
    }

    const result = await original(...args);

    if (hold?.timing === 'after') {
      await arriveAt(hold);
    }

    return result;
  });
  callHoldsBySpy.set(methods[method] as object, callHolds);

  return callHolds;
}

async function arriveAt(hold: CallHold): Promise<void> {
  await hold.onHold?.();
  await hold.barrier.arrive();
}
