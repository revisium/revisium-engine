import { performance } from 'node:perf_hooks';
import { TransactionPrismaClient } from 'src/features/share/types';
import {
  isConnectionLost,
  sqlStateOf,
} from 'src/infrastructure/database/database-errors';
import { OperationTimeoutException } from 'src/infrastructure/database/operation-timeout.exception';
import { TransactionTimeoutSupport } from 'src/infrastructure/database/transaction-timeout-support';

const TRANSACTION_TIMEOUT_TERMINATION = '25P04';
const QUERY_CANCELED = '57014';

// PostgreSQL reads a timeout of 0 as "no timeout", so a passed deadline still sets the smallest one.
const SMALLEST_TIMEOUT_MS = 1;

// The callback settles this long before the deadline, so its rollback reaches the server before the database's own
// limits end the session: a session ended during the rollback returns to the pool as a dead connection.
const ROLLBACK_LEAD_MS = 100;

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
    try {
      await this.enforce($prisma);

      const result = await this.settledByDeadline(body(this));

      await this.checkpoint();
      this.refuseIfPassed();

      return result;
    } catch (error) {
      await this.letEndedSessionSurface();
      throw error;
    }
  }

  public async checkpoint(): Promise<void> {
    this.refuseIfPassed();

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

  public remainingMs(): number {
    return Math.max(Math.ceil(this.endsAt - performance.now()), 0);
  }

  public exceeded(): OperationTimeoutException {
    return new OperationTimeoutException(this.timeoutMs);
  }

  private refuseIfPassed(): void {
    if (this.hasPassed()) {
      throw this.exceeded();
    }
  }

  private settledByDeadline<T>(operation: Promise<T>): Promise<T> {
    // Past the deadline the operation is abandoned while it still runs; its later failure is expected.
    operation.catch(() => undefined);

    let expiry: NodeJS.Timeout | undefined;
    const deadlineReached = new Promise<never>((_, reject) => {
      expiry = setTimeout(
        () => reject(new OperationTimeoutException(this.timeoutMs)),
        Math.max(this.remainingMs() - ROLLBACK_LEAD_MS, 0),
      );
    });

    return Promise.race([operation, deadlineReached]).finally(() =>
      clearTimeout(expiry),
    );
  }

  // Past the deadline the database may have ended the session while the event loop was busy. Waiting for the next
  // poll phase lets pg read that from the socket first, so the rollback fails fast and the ended connection leaves
  // the pool instead of serving the next query.
  private async letEndedSessionSurface(): Promise<void> {
    if (this.hasPassed()) {
      await afterNextPollPhase();
    }
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
      (this.enforcement?.kind === 'statementLimits' &&
        sqlStateOf(error) === QUERY_CANCELED) ||
      (this.enforcement !== undefined && isConnectionLost(error))
    );
  }

  private hasPassed(): boolean {
    return performance.now() >= this.endsAt;
  }

  private remainingBudget(): string {
    return String(Math.max(this.remainingMs(), SMALLEST_TIMEOUT_MS));
  }
}

// A setImmediate callback runs after the current poll phase; the one it schedules runs after the next poll phase.
function afterNextPollPhase(): Promise<void> {
  return new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
}
