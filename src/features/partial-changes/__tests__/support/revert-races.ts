import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { Barrier } from 'src/__tests__/utils/barrier';
import {
  waitUntilQueuedBehindFence,
  waitUntilWrittenWithoutQueuing,
} from 'src/features/draft/commands/handlers/__tests__/support/branch-write-fence';
import type { RevertChangesResult } from 'src/features/partial-changes/commands/impl/revert-draft-changes.command';
import { ChangePlanner } from 'src/features/partial-changes/planning/change-planner';
import type { RevertOptions } from './change-reverting';
import type { ChangesScenario } from './changes-scenario';
import { TargetWriteHolds } from './target-write-holds';

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
  const holds = TargetWriteHolds.ofReverts(kit, 1);
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
  const holds = TargetWriteHolds.ofReverts(kit, 1);
  const overtakenReverting = draft.revertChanges(reverts.overtaken);
  const overtakenWrite = holds.barrierOf(1);

  await overtakenWrite.expectReachedBefore(overtakenReverting);
  const overtaking = await draft.revertChanges(reverts.overtaking);
  overtakenWrite.release();

  return { overtaken: await overtakenReverting, overtaking };
}

// Each attempt is held after it planned and before it writes, under the fence it entered.
export class HeldPartialRevert {
  private readonly holds: TargetWriteHolds;

  private readonly result: Promise<RevertChangesResult>;

  private attemptsReached = 0;

  constructor(
    private readonly kit: PartialChangesTestKit,
    private readonly draft: ChangesScenario,
    options: RevertOptions,
  ) {
    this.holds = TargetWriteHolds.ofReverts(kit, Number.POSITIVE_INFINITY);
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
