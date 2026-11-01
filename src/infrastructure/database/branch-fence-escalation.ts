import { Injectable } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import { BranchWriteFenceService } from 'src/infrastructure/database/branch-write-fence.service';
import { BranchWriteFencedException } from 'src/infrastructure/database/branch-write-fenced.exception';
import { EscalationSlots } from 'src/infrastructure/database/escalation-slots';
import { PrismaService } from 'src/infrastructure/database/prisma.service';

export interface ProjectBranch {
  readonly projectId: string;
  readonly branchName: string;
}

export interface EscalatedAttempt {
  readonly branchId: string;
  readonly timeoutMs: number;
  takeFence(): Promise<void>;
}

export interface EscalationDeadline {
  remainingMs(): number;
  exceeded(): Error;
}

interface WaitLimit {
  readonly waitMs: number;
  failureOf(error: unknown): unknown;
}

type Attempt<T> = (escalated: EscalatedAttempt) => Promise<T>;

const WITHOUT_DEADLINE: EscalationDeadline = {
  remainingMs: () => Number.POSITIVE_INFINITY,
  exceeded: () =>
    new Error('An escalation without a deadline cannot exceed it'),
};

@Injectable()
export class BranchFenceEscalation {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly branchWriteFence: BranchWriteFenceService,
    private readonly escalationSlots: EscalationSlots,
  ) {}

  public runEscalated<T>(
    branch: ProjectBranch,
    timeoutMs: number,
    attempt: Attempt<T>,
  ): Promise<T> {
    return this.escalate(branch, attempt, this.waitsOf(timeoutMs));
  }

  public runEscalatedBefore<T>(
    deadline: EscalationDeadline,
    branch: ProjectBranch,
    attempt: Attempt<T>,
  ): Promise<T> {
    return this.escalate(
      branch,
      attempt,
      this.waitsOf(deadline.remainingMs(), deadline),
    );
  }

  private waitsOf(
    timeoutMs: number,
    deadline = WITHOUT_DEADLINE,
  ): EscalationWaits {
    return new EscalationWaits(
      this.branchWriteFence.waitLimitMs,
      timeoutMs,
      deadline,
    );
  }

  private async escalate<T>(
    branch: ProjectBranch,
    attempt: Attempt<T>,
    waits: EscalationWaits,
  ): Promise<T> {
    await waitWithin(waits.forSlot(), (waitMs) =>
      this.escalationSlots.acquire(waitMs),
    );

    try {
      waits.slotTaken();

      return await this.runUnderHolder(branch, attempt, waits);
    } finally {
      this.escalationSlots.release();
    }
  }

  private async runUnderHolder<T>(
    branch: ProjectBranch,
    attempt: Attempt<T>,
    waits: EscalationWaits,
  ): Promise<T> {
    const branchId = await this.findBranchId(branch);
    waits.refuseIfDeadlinePassed();

    const timeoutMs = waits.attemptTimeoutMs();
    const fence = this.branchWriteFence.exclusiveHolder(branchId, timeoutMs);

    try {
      return await attempt({
        branchId,
        timeoutMs,
        takeFence: () =>
          waitWithin(waits.forFence(), (waitMs) => fence.acquire(waitMs)),
      });
    } finally {
      await fence.release();
    }
  }

  private async findBranchId({
    projectId,
    branchName,
  }: ProjectBranch): Promise<string> {
    const branch = await this.prismaService.branch.findUniqueOrThrow({
      where: { name_projectId: { name: branchName, projectId } },
      select: { id: true },
    });

    return branch.id;
  }
}

// The waits for a slot and for the fence share the native wait limit, measured from the escalation's start, and
// never outlast the deadline; a wait the deadline cut short fails as the deadline's failure.
class EscalationWaits {
  private readonly startedAt = performance.now();

  private fenceWaitSpentMs = 0;

  constructor(
    private readonly waitLimitMs: number,
    private readonly timeoutMs: number,
    private readonly deadline: EscalationDeadline,
  ) {}

  public forSlot(): WaitLimit {
    return this.boundedByDeadline(this.waitLimitMs);
  }

  public slotTaken(): void {
    this.fenceWaitSpentMs = Math.ceil(performance.now() - this.startedAt);
    this.refuseIfDeadlinePassed();
  }

  public forFence(): WaitLimit {
    return this.boundedByDeadline(this.waitLimitMs - this.fenceWaitSpentMs);
  }

  public attemptTimeoutMs(): number {
    return Math.min(
      this.timeoutMs - this.fenceWaitSpentMs,
      this.deadline.remainingMs(),
    );
  }

  public refuseIfDeadlinePassed(): void {
    if (this.deadline.remainingMs() <= 0) {
      throw this.deadline.exceeded();
    }
  }

  private boundedByDeadline(waitMs: number): WaitLimit {
    const remainingMs = this.deadline.remainingMs();

    if (waitMs <= remainingMs) {
      return { waitMs, failureOf: (error) => error };
    }

    return {
      waitMs: remainingMs,
      failureOf: (error) => this.deadlineFailureOf(error),
    };
  }

  private deadlineFailureOf(error: unknown): unknown {
    if (error instanceof BranchWriteFencedException) {
      return this.deadline.exceeded();
    }

    return error;
  }
}

async function waitWithin(
  limit: WaitLimit,
  wait: (waitMs: number) => Promise<void>,
): Promise<void> {
  try {
    await wait(limit.waitMs);
  } catch (error) {
    throw limit.failureOf(error);
  }
}
