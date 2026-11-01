import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { CommitChangesResult } from 'src/features/partial-changes/commands/impl/commit-draft-changes.command';
import { ChangePlanner } from 'src/features/partial-changes/planning/change-planner';
import type { CommitOptions } from './change-committing';
import type { ChangesScenario } from './changes-scenario';
import { TargetWriteHolds } from './target-write-holds';

export interface RetriedCommit {
  readonly result: CommitChangesResult;
  readonly attempts: number;
}

export interface OvertakenCommit<T> {
  readonly overtaken: CommitChangesResult;
  readonly overtaking: T;
}

// The native write lands after the commit planned and before it writes, so it changes what the commit read.
export async function commitWhileNativeWriteLands(
  kit: PartialChangesTestKit,
  draft: ChangesScenario,
  options: CommitOptions,
  nativeWrite: () => Promise<unknown>,
): Promise<RetriedCommit> {
  const plans = jest.spyOn(kit.module.get(ChangePlanner), 'plan');
  const holds = TargetWriteHolds.ofCommits(kit, 1);
  const committing = draft.commitChanges(options);
  const firstWrite = holds.barrierOf(1);

  await firstWrite.expectReachedBefore(committing);
  await nativeWrite();
  firstWrite.release();

  return { result: await committing, attempts: plans.mock.calls.length };
}

// The overtaken commit planned first; the overtaking operation plans and applies before the overtaken one writes.
export async function commitOvertakenBy<T>(
  kit: PartialChangesTestKit,
  draft: ChangesScenario,
  overtaken: CommitOptions,
  overtakingOperation: () => Promise<T>,
): Promise<OvertakenCommit<T>> {
  const holds = TargetWriteHolds.ofCommits(kit, 1);
  const overtakenCommitting = draft.commitChanges(overtaken);
  const overtakenWrite = holds.barrierOf(1);

  await overtakenWrite.expectReachedBefore(overtakenCommitting);
  const overtaking = await overtakingOperation();
  overtakenWrite.release();

  return { overtaken: await overtakenCommitting, overtaking };
}
