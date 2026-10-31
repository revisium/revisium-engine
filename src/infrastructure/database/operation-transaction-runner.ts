import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { setTimeout as waitFor } from 'node:timers/promises';
import { TransactionIsolationLevel } from 'src/engine-prisma-types';
import { TransactionPrismaClient } from 'src/features/share/types';
import { isSerializationFailure } from 'src/infrastructure/database/database-errors';
import {
  NumericSetting,
  readNumericSetting,
} from 'src/infrastructure/database/numeric-setting';
import {
  DeadlineHandle,
  OperationDeadline,
} from 'src/infrastructure/database/operation-deadline';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { retryDelayMs } from 'src/infrastructure/database/retry-backoff';
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

// The database and the deadline checkpoints end an attempt. Prisma's own timer rolls back from a detached callback,
// and on a session the database has already ended that rollback fails as an unhandled rejection, so it stays far
// beyond the deadline and fires only for an operation that never settles.
const PRISMA_TIMEOUT_FACTOR = 10;

type AttemptOptions = Omit<TransactionOptions, 'retry'>;

type Operation<T> = (deadline: DeadlineHandle) => Promise<T>;

@Injectable()
export class OperationTransactionRunner {
  private readonly logger = new Logger(OperationTransactionRunner.name);

  private readonly maxAttempts: number;

  private readonly operationTimeoutMs: number;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly transactionService: TransactionPrismaService,
    private readonly transactionTimeoutSupport: TransactionTimeoutSupport,
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

  public async runWrite<T>(planAndWrite: Operation<T>): Promise<T> {
    for (let attempt = 0; attempt < this.maxAttempts - 1; attempt++) {
      try {
        return await this.runWriteAttempt(planAndWrite);
      } catch (error) {
        if (!isSerializationFailure(error)) {
          throw error;
        }

        await this.backOff(attempt);
      }
    }

    return this.runWriteAttempt(planAndWrite);
  }

  public runPlanning<T>(plan: Operation<T>): Promise<T> {
    return this.runAttempt(
      TransactionIsolationLevel.RepeatableRead,
      (deadline) => this.planReadOnly(plan, deadline),
    );
  }

  private runWriteAttempt<T>(planAndWrite: Operation<T>): Promise<T> {
    return this.runAttempt(
      TransactionIsolationLevel.Serializable,
      planAndWrite,
    );
  }

  private backOff(attempt: number): Promise<void> {
    return waitFor(
      retryDelayMs(attempt, this.transactionService.serializableRetryBackoff),
    );
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
  ): Promise<T> {
    const deadline = new OperationDeadline(
      this.operationTimeoutMs,
      this.transactionTimeoutSupport,
    );

    try {
      return await this.prismaService.$transaction(
        ($prisma) => this.runBeforeDeadline($prisma, deadline, operation),
        this.attemptOptions(isolationLevel),
      );
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
      timeout: PRISMA_TIMEOUT_FACTOR * this.operationTimeoutMs,
    };
  }
}
