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
import { OperationDeadline } from 'src/infrastructure/database/operation-deadline';
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

// The database ends an attempt at its deadline; Prisma's own timer only has to stay out of its way.
const PRISMA_TIMEOUT_MARGIN_MS = 1_000;

type AttemptOptions = Omit<TransactionOptions, 'retry'>;

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

  public async runWrite<T>(planAndWrite: () => Promise<T>): Promise<T> {
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

  public runPlanning<T>(plan: () => Promise<T>): Promise<T> {
    return this.runAttempt(TransactionIsolationLevel.RepeatableRead, () =>
      this.planReadOnly(plan),
    );
  }

  private runWriteAttempt<T>(planAndWrite: () => Promise<T>): Promise<T> {
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

  private async planReadOnly<T>(plan: () => Promise<T>): Promise<T> {
    await this.transactionService.getTransaction()
      .$executeRaw`SET TRANSACTION READ ONLY`;

    return plan();
  }

  private async runAttempt<T>(
    isolationLevel: TransactionIsolationLevel,
    operation: () => Promise<T>,
  ): Promise<T> {
    const deadline = new OperationDeadline(
      this.operationTimeoutMs,
      this.prismaService,
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
    operation: () => Promise<T>,
  ): Promise<T> {
    return deadline.run($prisma, () =>
      this.transactionService.runInTransactionContext($prisma, operation),
    );
  }

  private attemptOptions(
    isolationLevel: TransactionIsolationLevel,
  ): AttemptOptions {
    return {
      isolationLevel,
      maxWait: this.transactionService.serializableMaxWaitMs,
      timeout: this.operationTimeoutMs + PRISMA_TIMEOUT_MARGIN_MS,
    };
  }
}
