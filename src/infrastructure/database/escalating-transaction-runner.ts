import { Injectable } from '@nestjs/common';
import { setTimeout as waitFor } from 'node:timers/promises';
import { TransactionIsolationLevel } from 'src/engine-prisma-types';
import {
  BranchFenceEscalation,
  ProjectBranch,
} from 'src/infrastructure/database/branch-fence-escalation';
import { isSerializationFailure } from 'src/infrastructure/database/database-errors';
import { retryDelayMs } from 'src/infrastructure/database/retry-backoff';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

type Operation<T> = () => Promise<T>;

@Injectable()
export class EscalatingTransactionRunner {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly escalation: BranchFenceEscalation,
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
    if (!this.escalation.isDueFor(attempt)) {
      return this.runSerializableAttempt(
        operation,
        this.transactionService.serializableTimeoutMs,
      );
    }

    return this.escalation.runEscalated(
      branch,
      this.transactionService.serializableTimeoutMs,
      (escalated) =>
        this.runSerializableAttempt(async () => {
          await escalated.takeFence();

          return this.transactionService.runInExclusiveHeldAdmission(
            escalated.branchId,
            operation,
          );
        }, escalated.timeoutMs),
    );
  }

  private runSerializableAttempt<T>(
    operation: Operation<T>,
    timeoutMs: number,
  ): Promise<T> {
    return this.transactionService.run(operation, {
      isolationLevel: TransactionIsolationLevel.Serializable,
      maxWait: this.transactionService.serializableMaxWaitMs,
      timeout: timeoutMs,
    });
  }

  private backOff(attempt: number): Promise<void> {
    return waitFor(
      retryDelayMs(attempt, this.transactionService.serializableRetryBackoff),
    );
  }
}
