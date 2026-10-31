import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { setTimeout as waitFor } from 'node:timers/promises';
import { TransactionIsolationLevel } from 'src/engine-prisma-types';
import {
  isSerializationFailure,
  sqlStateOf,
} from 'src/infrastructure/database/database-errors';
import {
  NumericSetting,
  readNumericSetting,
} from 'src/infrastructure/database/numeric-setting';
import {
  OperationDeadline,
  setLocalTimeoutToDeadline,
} from 'src/infrastructure/database/operation-deadline';
import { OperationTimeoutException } from 'src/infrastructure/database/operation-timeout.exception';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { retryDelayMs } from 'src/infrastructure/database/retry-backoff';
import { StatementBudgets } from 'src/infrastructure/database/statement-budgets';
import {
  TransactionOptions,
  TransactionPrismaService,
} from 'src/infrastructure/database/transaction-prisma.service';

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

const PRISMA_TRANSACTION_EXPIRED = 'P2028';
const TRANSACTION_TIMEOUT_TERMINATION = '25P04';

type AttemptOptions = Omit<TransactionOptions, 'retry'>;

@Injectable()
export class OperationTransactionRunner {
  private readonly logger = new Logger(OperationTransactionRunner.name);

  private readonly maxAttempts: number;

  private readonly operationTimeoutMs: number;

  private readonly statementBudgets: StatementBudgets;

  private transactionTimeoutArmable?: boolean;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly transactionService: TransactionPrismaService,
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
    this.statementBudgets = new StatementBudgets(
      prismaService,
      transactionService,
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
    const deadline = new OperationDeadline(this.operationTimeoutMs);

    try {
      return await this.runUntilDeadline(
        deadline,
        this.attemptOptions(isolationLevel),
        operation,
      );
    } catch (error) {
      if (endedByDeadline(error, deadline)) {
        throw new OperationTimeoutException(this.operationTimeoutMs, error);
      }

      throw error;
    }
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

  private async runUntilDeadline<T>(
    deadline: OperationDeadline,
    options: AttemptOptions,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (await this.canArmTransactionTimeout()) {
      return this.runWithTransactionTimeout(deadline, options, operation);
    }

    return this.statementBudgets.runTransaction(deadline, options, operation);
  }

  private runWithTransactionTimeout<T>(
    deadline: OperationDeadline,
    options: AttemptOptions,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.prismaService.$transaction(async ($prisma) => {
      await setLocalTimeoutToDeadline($prisma, 'transaction_timeout', deadline);
      return this.transactionService.runInTransactionContext(
        $prisma,
        operation,
      );
    }, options);
  }

  private async canArmTransactionTimeout(): Promise<boolean> {
    this.transactionTimeoutArmable ??= await this.probeTransactionTimeout();

    return this.transactionTimeoutArmable;
  }

  // PostgreSQL before 17 has no transaction_timeout (NULL). A non-zero server default starts its timer at BEGIN,
  // and SET LOCAL inside the transaction then neither extends nor shortens it.
  private async probeTransactionTimeout(): Promise<boolean> {
    const [probe] = await this.prismaService.$queryRaw<
      { armable: boolean | null }[]
    >`SELECT current_setting('transaction_timeout', true) = '0' AS armable`;

    return probe?.armable === true;
  }
}

// A session that transaction_timeout terminates between statements fails the next statement or the commit
// with a lost connection and no SQLSTATE, so a failure after the deadline counts as the timeout too.
function endedByDeadline(error: unknown, deadline: OperationDeadline): boolean {
  const code = (error as { code?: string } | undefined)?.code;

  return (
    deadline.hasPassed() ||
    code === PRISMA_TRANSACTION_EXPIRED ||
    sqlStateOf(error) === TRANSACTION_TIMEOUT_TERMINATION
  );
}
