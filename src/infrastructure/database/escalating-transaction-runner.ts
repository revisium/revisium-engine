import { Injectable } from '@nestjs/common';
import { TransactionIsolationLevel } from 'src/engine-prisma-types';
import {
  BranchFenceEscalation,
  ProjectBranch,
} from 'src/infrastructure/database/branch-fence-escalation';
import {
  retryOnSerializationFailure,
  SerializationRetryLimits,
} from 'src/infrastructure/database/serialization-retry';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

type Operation<T> = () => Promise<T>;

@Injectable()
export class EscalatingTransactionRunner {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly escalation: BranchFenceEscalation,
  ) {}

  public runSerializable<T>(
    branch: ProjectBranch,
    operation: Operation<T>,
  ): Promise<T> {
    return retryOnSerializationFailure(this.retryLimits(), {
      run: () =>
        this.runSerializableAttempt(
          operation,
          this.transactionService.serializableTimeoutMs,
        ),
      runEscalated: () => this.runEscalatedAttempt(branch, operation),
    });
  }

  private runEscalatedAttempt<T>(
    branch: ProjectBranch,
    operation: Operation<T>,
  ): Promise<T> {
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

  private retryLimits(): SerializationRetryLimits {
    return {
      maxAttempts: this.transactionService.serializableMaxAttempts,
      backoff: this.transactionService.serializableRetryBackoff,
    };
  }
}
