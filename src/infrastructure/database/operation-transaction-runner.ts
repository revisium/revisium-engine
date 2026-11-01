import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TransactionIsolationLevel } from 'src/engine-prisma-types';
import { TransactionPrismaClient } from 'src/features/share/types';
import {
  BranchFenceEscalation,
  ProjectBranch,
} from 'src/infrastructure/database/branch-fence-escalation';
import {
  NumericSetting,
  readNumericSetting,
} from 'src/infrastructure/database/numeric-setting';
import {
  DeadlineHandle,
  OperationDeadline,
} from 'src/infrastructure/database/operation-deadline';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import {
  retryOnSerializationFailure,
  SerializationRetryLimits,
} from 'src/infrastructure/database/serialization-retry';
import {
  TransactionOptions,
  TransactionPrismaService,
} from 'src/infrastructure/database/transaction-prisma.service';
import { TransactionTimeoutSupport } from 'src/infrastructure/database/transaction-timeout-support';

const MAX_ATTEMPTS: NumericSetting = {
  envKey: 'PARTIAL_CHANGES_MAX_ATTEMPTS',
  defaultValue: 3,
  minValue: 1,
};

const OPERATION_TIMEOUT_MS: NumericSetting = {
  envKey: 'PARTIAL_CHANGES_OPERATION_TIMEOUT_MS',
  defaultValue: 180_000,
  minValue: 1,
};

// The callback settles by the deadline and Prisma rolls back on its awaited path. Prisma's own timer rolls back from
// a detached callback, which fails unhandled on a session the database has ended, so it stays a grace beyond.
const PRISMA_TIMEOUT_GRACE_MS = 30_000;

type AttemptOptions = Omit<TransactionOptions, 'retry'>;

type Operation<T> = (deadline: DeadlineHandle) => Promise<T>;

interface AttemptStart {
  readonly deadline: OperationDeadline;
  readonly beforeSnapshot: () => Promise<void>;
}

@Injectable()
export class OperationTransactionRunner {
  private readonly logger = new Logger(OperationTransactionRunner.name);

  private readonly maxAttempts: number;

  private readonly operationTimeoutMs: number;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly transactionService: TransactionPrismaService,
    private readonly transactionTimeoutSupport: TransactionTimeoutSupport,
    private readonly escalation: BranchFenceEscalation,
    configService: ConfigService,
  ) {
    this.maxAttempts = readNumericSetting(
      configService,
      MAX_ATTEMPTS,
      this.logger,
    );
    this.operationTimeoutMs = readNumericSetting(
      configService,
      OPERATION_TIMEOUT_MS,
      this.logger,
    );
  }

  public runWrite<T>(
    branch: ProjectBranch,
    planAndWrite: Operation<T>,
  ): Promise<T> {
    return retryOnSerializationFailure(this.writeRetryLimits(), {
      run: () =>
        this.runAttempt(
          TransactionIsolationLevel.Serializable,
          planAndWrite,
          this.unfencedStart(),
        ),
      runEscalated: () => this.runEscalatedAttempt(branch, planAndWrite),
    });
  }

  public runPlanning<T>(plan: Operation<T>): Promise<T> {
    return this.runAttempt(
      TransactionIsolationLevel.RepeatableRead,
      (deadline) => this.planReadOnly(plan, deadline),
      this.unfencedStart(),
    );
  }

  private runEscalatedAttempt<T>(
    branch: ProjectBranch,
    planAndWrite: Operation<T>,
  ): Promise<T> {
    const deadline = this.startDeadline();

    return this.escalation.runEscalatedBefore(deadline, branch, (escalated) =>
      this.runAttempt(
        TransactionIsolationLevel.Serializable,
        (handle) =>
          this.transactionService.runInExclusiveHeldAdmission(
            escalated.branchId,
            () => planAndWrite(handle),
          ),
        { deadline, beforeSnapshot: () => escalated.takeFence() },
      ),
    );
  }

  private unfencedStart(): AttemptStart {
    return {
      deadline: this.startDeadline(),
      beforeSnapshot: () => Promise.resolve(),
    };
  }

  private startDeadline(): OperationDeadline {
    return new OperationDeadline(
      this.operationTimeoutMs,
      this.transactionTimeoutSupport,
    );
  }

  private writeRetryLimits(): SerializationRetryLimits {
    return {
      maxAttempts: this.maxAttempts,
      backoff: this.transactionService.serializableRetryBackoff,
    };
  }

  private async planReadOnly<T>(
    plan: Operation<T>,
    deadline: DeadlineHandle,
  ): Promise<T> {
    await this.transactionService.getTransaction()
      .$executeRaw`SET TRANSACTION READ ONLY`;

    return plan(deadline);
  }

  private async runAttempt<T>(
    isolationLevel: TransactionIsolationLevel,
    operation: Operation<T>,
    { deadline, beforeSnapshot }: AttemptStart,
  ): Promise<T> {
    try {
      return await this.prismaService.$transaction(async ($prisma) => {
        await beforeSnapshot();

        return this.runBeforeDeadline($prisma, deadline, operation);
      }, this.attemptOptions(isolationLevel));
    } catch (error) {
      throw deadline.failureOf(error);
    }
  }

  private runBeforeDeadline<T>(
    $prisma: TransactionPrismaClient,
    deadline: OperationDeadline,
    operation: Operation<T>,
  ): Promise<T> {
    return deadline.run($prisma, (handle) =>
      this.transactionService.runInTransactionContext($prisma, () =>
        operation(handle),
      ),
    );
  }

  private attemptOptions(
    isolationLevel: TransactionIsolationLevel,
  ): AttemptOptions {
    return {
      isolationLevel,
      maxWait: this.transactionService.serializableMaxWaitMs,
      timeout: this.operationTimeoutMs + PRISMA_TIMEOUT_GRACE_MS,
    };
  }
}
