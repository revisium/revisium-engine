import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import { createBarrier, type Barrier } from 'src/__tests__/utils/barrier';
import { DraftRevisionTargetApiService } from 'src/features/draft-revision/draft-revision-target-api.service';
import {
  waitUntilQueuedBehindFence,
  waitUntilWrittenWithoutQueuing,
} from 'src/features/draft/commands/handlers/__tests__/support/branch-write-fence';
import type { RevertChangesResult } from 'src/features/partial-changes/commands/impl/revert-draft-changes.command';
import { ChangePlanner } from 'src/features/partial-changes/planning/change-planner';
import type { RevertOptions } from './change-reverting';
import type { ChangesScenario } from './changes-scenario';

type Write = () => Promise<unknown>;

export interface RetriedRevert {
  readonly result: RevertChangesResult;
  readonly attempts: number;
}

export interface OvertakenRevert {
  readonly overtaken: RevertChangesResult;
  readonly overtaking: RevertChangesResult;
}

export interface QueuedWrite {
  readonly writing: Promise<unknown>;
}

// The native write lands after the revert planned and before it writes, so it changes what the revert read.
export async function revertWhileNativeWriteLands(
  kit: PartialChangesTestKit,
  draft: ChangesScenario,
  options: RevertOptions,
  nativeWrite: Write,
): Promise<RetriedRevert> {
  const plans = jest.spyOn(kit.module.get(ChangePlanner), 'plan');
  const holds = new RevertWriteHolds(kit, 1);
  const reverting = draft.revertChanges(options);
  const firstWrite = holds.barrierOf(1);

  await firstWrite.expectReachedBefore(reverting);
  await nativeWrite();
  firstWrite.release();

  return { result: await reverting, attempts: plans.mock.calls.length };
}

// The overtaken revert planned first; the overtaking one plans and applies before the overtaken one writes.
export async function revertOvertakenByAnotherRevert(
  kit: PartialChangesTestKit,
  draft: ChangesScenario,
  reverts: { overtaken: RevertOptions; overtaking: RevertOptions },
): Promise<OvertakenRevert> {
  const holds = new RevertWriteHolds(kit, 1);
  const overtakenReverting = draft.revertChanges(reverts.overtaken);
  const overtakenWrite = holds.barrierOf(1);

  await overtakenWrite.expectReachedBefore(overtakenReverting);
  const overtaking = await draft.revertChanges(reverts.overtaking);
  overtakenWrite.release();

  return { overtaken: await overtakenReverting, overtaking };
}

// Each attempt is held after it planned and before it writes, under the fence it entered.
export class HeldPartialRevert {
  private readonly holds: RevertWriteHolds;

  private readonly result: Promise<RevertChangesResult>;

  private attemptsReached = 0;

  constructor(
    private readonly kit: PartialChangesTestKit,
    private readonly draft: ChangesScenario,
    options: RevertOptions,
  ) {
    this.holds = new RevertWriteHolds(kit, Number.POSITIVE_INFINITY);
    this.result = draft.revertChanges(options);
    this.result.catch(() => undefined);
  }

  public async losesAttemptTo(write: Write): Promise<void> {
    const attempt = await this.nextHeldAttempt();

    try {
      await waitUntilWrittenWithoutQueuing(
        this.fenceDatabase,
        this.draft.branchId,
        write(),
      );
    } finally {
      attempt.release();
    }
  }

  public async queuesBehindFence(write: Write): Promise<QueuedWrite> {
    await this.nextHeldAttempt();

    const writing = write();
    writing.catch(() => undefined);
    await waitUntilQueuedBehindFence(
      this.fenceDatabase,
      this.draft.branchId,
      writing,
    );

    return { writing };
  }

  public outcome(): Promise<RevertChangesResult> {
    this.holds.releaseAll();

    return this.result;
  }

  private async nextHeldAttempt(): Promise<Barrier> {
    this.attemptsReached += 1;
    const attempt = this.holds.barrierOf(this.attemptsReached);
    await attempt.expectReachedBefore(this.result);

    return attempt;
  }

  private get fenceDatabase() {
    return { prismaService: this.kit.prisma };
  }
}

class RevertWriteHolds {
  private readonly barriers = new Map<number, Barrier>();

  private writesStarted = 0;

  constructor(
    kit: PartialChangesTestKit,
    private heldWrites: number,
  ) {
    const api = kit.module.get(DraftRevisionTargetApiService);
    const revertToTarget = api.revertToTarget.bind(api);

    jest.spyOn(api, 'revertToTarget').mockImplementation(async (plan) => {
      this.writesStarted += 1;

      if (this.writesStarted <= this.heldWrites) {
        await this.barrierOf(this.writesStarted).arrive();
      }

      return revertToTarget(plan);
    });
  }

  public barrierOf(write: number): Barrier {
    const existing = this.barriers.get(write);

    if (existing) {
      return existing;
    }

    const barrier = createBarrier(`Write ${write} of a partial revert`);
    this.barriers.set(write, barrier);

    return barrier;
  }

  public releaseAll(): void {
    this.heldWrites = this.writesStarted;

    for (const barrier of this.barriers.values()) {
      barrier.release();
    }
  }
}
