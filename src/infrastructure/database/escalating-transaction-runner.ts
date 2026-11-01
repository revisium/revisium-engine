import { Injectable } from '@nestjs/common';
import { setTimeout as waitFor } from 'node:timers/promises';
import { TransactionIsolationLevel } from 'src/engine-prisma-types';
import { BranchWriteFenceService } from 'src/infrastructure/database/branch-write-fence.service';
import { isSerializationFailure } from 'src/infrastructure/database/database-errors';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { retryDelayMs } from 'src/infrastructure/database/retry-backoff';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

const SERIALIZATION_FAILURES_BEFORE_ESCALATION = 2;

interface ProjectBranch {
  projectId: string;
  branchName: string;
}

type Operation<T> = () => Promise<T>;

@Injectable()
export class EscalatingTransactionRunner {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly transactionService: TransactionPrismaService,
    private readonly branchWriteFence: BranchWriteFenceService,
  ) {}

  public async runSerializable<T>(
    branch: ProjectBranch,
    operation: Operation<T>,
  ): Promise<T> {
    const lastAttempt = this.transactionService.serializableMaxAttempts - 1;

    for (let attempt = 0; attempt < lastAttempt; attempt++) {
      try {
        return await this.runAttempt(attempt, branch, operation);
      } catch (error) {
        if (!isSerializationFailure(error)) {
          throw error;
        }

        await this.backOff(attempt);
      }
    }

    return this.runAttempt(lastAttempt, branch, operation);
  }

  private runAttempt<T>(
    attempt: number,
    branch: ProjectBranch,
    operation: Operation<T>,
  ): Promise<T> {
    if (attempt < SERIALIZATION_FAILURES_BEFORE_ESCALATION) {
      return this.runSerializableAttempt(operation);
    }

    return this.runUnderExclusiveFence(branch, operation);
  }

  private async runUnderExclusiveFence<T>(
    branch: ProjectBranch,
    operation: Operation<T>,
  ): Promise<T> {
    const branchId = await this.findBranchId(branch);
    const fence = this.branchWriteFence.exclusiveHolder(branchId);

    try {
      return await this.runSerializableAttempt(async () => {
        await fence.acquire();

        return this.transactionService.runInExclusiveHeldAdmission(
          branchId,
          operation,
        );
      });
    } finally {
      await fence.release();
    }
  }

  private runSerializableAttempt<T>(operation: Operation<T>): Promise<T> {
    return this.transactionService.run(operation, {
      isolationLevel: TransactionIsolationLevel.Serializable,
      maxWait: this.transactionService.serializableMaxWaitMs,
      timeout: this.transactionService.serializableTimeoutMs,
    });
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

  private backOff(attempt: number): Promise<void> {
    return waitFor(
      retryDelayMs(attempt, this.transactionService.serializableRetryBackoff),
    );
  }
}
