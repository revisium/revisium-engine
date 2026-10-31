import type { MigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';
import { createBarrier, type Barrier } from 'src/__tests__/utils/barrier';
import type { MigrationLease } from 'src/features/migration/services/migration-transition.service';
import type { MigrationStepResult } from 'src/features/migration/types/migration.types';

export interface OwnerHold {
  barrier: Barrier;
}

export interface PausedOwner {
  lease: MigrationLease;
  resume(): Promise<MigrationStepResult>;
}

const startedOwners: { hold: OwnerHold; result: Promise<unknown> }[] = [];

export async function startOwnerUntil(
  kit: MigrationTestKit,
  migrationId: string,
  hold: OwnerHold,
): Promise<PausedOwner> {
  const result = kit.migrationService.processMigration(migrationId);
  startedOwners.push({ hold, result });
  await hold.barrier.expectReachedBefore(result);

  return {
    lease: await readLease(kit, migrationId),
    resume() {
      hold.barrier.release();
      return result;
    },
  };
}

export async function releaseStartedOwners(): Promise<void> {
  const owners = startedOwners.splice(0);

  for (const { hold } of owners) {
    hold.barrier.release();
  }

  await Promise.allSettled(owners.map(({ result }) => result));
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

export function afterSwapBegins(kit: MigrationTestKit): OwnerHold {
  return holdCall(kit.migrationTransitions, 'beginSwap', 1, 'after');
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

interface CallHolds {
  calls: number;
  holds: Map<number, { barrier: Barrier; timing: HoldTiming }>;
}

const callHoldsBySpy = new WeakMap<object, CallHolds>();

function holdCall(
  target: object,
  method: string,
  callNumber: number,
  timing: HoldTiming,
): OwnerHold {
  const barrier = createBarrier(
    `The migration owner at ${method} call ${callNumber}`,
  );
  callHoldsOf(target, method).holds.set(callNumber, { barrier, timing });

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
      await hold.barrier.arrive();
    }

    const result = await original(...args);

    if (hold?.timing === 'after') {
      await hold.barrier.arrive();
    }

    return result;
  });
  callHoldsBySpy.set(methods[method] as object, callHolds);

  return callHolds;
}
