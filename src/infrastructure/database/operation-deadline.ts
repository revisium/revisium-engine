import { performance } from 'node:perf_hooks';
import { TransactionPrismaClient } from 'src/features/share/types';
import {
  errorCodeOf,
  isConnectionLost,
  sqlStateOf,
} from 'src/infrastructure/database/database-errors';
import { OperationTimeoutException } from 'src/infrastructure/database/operation-timeout.exception';
import { TransactionTimeoutSupport } from 'src/infrastructure/database/transaction-timeout-support';

const PRISMA_TRANSACTION_CLOSED = 'P2028';
const TRANSACTION_TIMEOUT_TERMINATION = '25P04';
const QUERY_CANCELED = '57014';

// PostgreSQL reads a timeout of 0 as "no timeout", so a passed deadline still sets the smallest one.
const SMALLEST_TIMEOUT_MS = 1;

type Enforcement =
  | { kind: 'transactionTimeout' }
  | { kind: 'statementLimits'; transaction: TransactionPrismaClient };

export interface DeadlineHandle {
  checkpoint(): Promise<void>;
}

export class OperationDeadline implements DeadlineHandle {
  private readonly endsAt: number;

  private enforcement?: Enforcement;

  constructor(
    private readonly timeoutMs: number,
    private readonly transactionTimeoutSupport: TransactionTimeoutSupport,
  ) {
    this.endsAt = performance.now() + timeoutMs;
  }

  public async run<T>(
    $prisma: TransactionPrismaClient,
    body: (deadline: DeadlineHandle) => Promise<T>,
  ): Promise<T> {
    await this.enforce($prisma);

    const result = await body(this);

    await this.checkpoint();

    return result;
  }

  public async checkpoint(): Promise<void> {
    if (this.hasPassed()) {
      throw new OperationTimeoutException(this.timeoutMs);
    }

    if (this.enforcement?.kind === 'statementLimits') {
      await this.limitStatementsAndIdleTime(this.enforcement.transaction);
    }
  }

  public failureOf(error: unknown): unknown {
    if (error instanceof OperationTimeoutException) {
      return error;
    }

    if (this.endedOperation(error)) {
      return new OperationTimeoutException(this.timeoutMs, error);
    }

    return error;
  }

  private async enforce($prisma: TransactionPrismaClient): Promise<void> {
    if (await this.transactionTimeoutSupport.isSupportedOn($prisma)) {
      await this.armTransactionTimeout($prisma);
      this.enforcement = { kind: 'transactionTimeout' };
    } else {
      this.enforcement = { kind: 'statementLimits', transaction: $prisma };
      await this.checkpoint();
    }
  }

  private async armTransactionTimeout(
    $prisma: TransactionPrismaClient,
  ): Promise<void> {
    // A non-zero server or role default starts its timer at BEGIN; 0 stops it, so the next value starts a new one.
    await $prisma.$executeRaw`SELECT set_config('transaction_timeout', '0', true)`;
    await $prisma.$executeRaw`SELECT set_config('transaction_timeout', ${this.remainingBudget()}, true)`;
  }

  private async limitStatementsAndIdleTime(
    $prisma: TransactionPrismaClient,
  ): Promise<void> {
    const budget = this.remainingBudget();

    await $prisma.$executeRaw`
      SELECT set_config('statement_timeout', ${budget}, true),
             set_config('idle_in_transaction_session_timeout', ${budget}, true)`;
  }

  private endedOperation(error: unknown): boolean {
    if (sqlStateOf(error) === TRANSACTION_TIMEOUT_TERMINATION) {
      return true;
    }

    return this.hasPassed() && this.failedAtDeadline(error);
  }

  private failedAtDeadline(error: unknown): boolean {
    return (
      errorCodeOf(error) === PRISMA_TRANSACTION_CLOSED ||
      (this.enforcement?.kind === 'statementLimits' &&
        sqlStateOf(error) === QUERY_CANCELED) ||
      (this.enforcement !== undefined && isConnectionLost(error))
    );
  }

  private hasPassed(): boolean {
    return performance.now() >= this.endsAt;
  }

  private remainingBudget(): string {
    const remainingMs = Math.ceil(this.endsAt - performance.now());

    return String(Math.max(remainingMs, SMALLEST_TIMEOUT_MS));
  }
}
