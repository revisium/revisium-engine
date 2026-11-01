import { Injectable } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import {
  BranchWriteFenceService,
  EscalatedAttemptBudget,
} from 'src/infrastructure/database/branch-write-fence.service';
import { EscalationSlots } from 'src/infrastructure/database/escalation-slots';
import { PrismaService } from 'src/infrastructure/database/prisma.service';

const SERIALIZATION_FAILURES_BEFORE_ESCALATION = 2;

export interface ProjectBranch {
  readonly projectId: string;
  readonly branchName: string;
}

export interface EscalatedAttempt {
  readonly branchId: string;
  readonly timeoutMs: number;
  takeFence(): Promise<void>;
}

type Attempt<T> = (escalated: EscalatedAttempt) => Promise<T>;

@Injectable()
export class BranchFenceEscalation {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly branchWriteFence: BranchWriteFenceService,
    private readonly escalationSlots: EscalationSlots,
  ) {}

  public isDueFor(attempt: number): boolean {
    return attempt >= SERIALIZATION_FAILURES_BEFORE_ESCALATION;
  }

  public async runEscalated<T>(
    branch: ProjectBranch,
    timeoutMs: number,
    attempt: Attempt<T>,
  ): Promise<T> {
    const escalatedAt = performance.now();
    await this.escalationSlots.acquire(this.branchWriteFence.waitLimitMs);

    try {
      const fenceWaitSpentMs = Math.ceil(performance.now() - escalatedAt);

      return await this.runUnderHolder(branch, attempt, {
        fenceWaitSpentMs,
        attemptTimeoutMs: timeoutMs - fenceWaitSpentMs,
      });
    } finally {
      this.escalationSlots.release();
    }
  }

  private async runUnderHolder<T>(
    branch: ProjectBranch,
    attempt: Attempt<T>,
    budget: EscalatedAttemptBudget,
  ): Promise<T> {
    const branchId = await this.findBranchId(branch);
    const fence = this.branchWriteFence.exclusiveHolder(branchId, budget);

    try {
      return await attempt({
        branchId,
        timeoutMs: budget.attemptTimeoutMs,
        takeFence: () => fence.acquire(),
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
