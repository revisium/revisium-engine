import { Logger } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import { TransactionPrismaClient } from 'src/features/share/types';
import {
  errorCodeOf,
  isConnectionLost,
  sqlStateOf,
} from 'src/infrastructure/database/database-errors';
import { OperationTimeoutException } from 'src/infrastructure/database/operation-timeout.exception';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionTimeoutSupport } from 'src/infrastructure/database/transaction-timeout-support';

const PRISMA_TRANSACTION_EXPIRED = 'P2028';
const TRANSACTION_TIMEOUT_TERMINATION = '25P04';
const QUERY_CANCELED = '57014';

// PostgreSQL reads a timeout of 0 as "no timeout", so a passed deadline still sets the smallest one.
const SMALLEST_TIMEOUT_MS = 1;

const logger = new Logger('OperationDeadline');

export class OperationDeadline {
  private readonly endsAt: number;

  private transactionTimeoutArmed = false;

  private watchdog?: NodeJS.Timeout;

  private watchdogFired = false;

  private cancellation?: Promise<void>;

  constructor(
    private readonly timeoutMs: number,
    private readonly prismaService: PrismaService,
    private readonly transactionTimeoutSupport: TransactionTimeoutSupport,
  ) {
    this.endsAt = performance.now() + timeoutMs;
  }

  public async run<T>(
    $prisma: TransactionPrismaClient,
    body: () => Promise<T>,
  ): Promise<T> {
    await this.enforce($prisma);

    const result = await this.watched(body);

    if (this.hasPassed()) {
      throw new OperationTimeoutException(this.timeoutMs);
    }

    return result;
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
    } else {
      this.startWatchdog(await readBackendPid($prisma));
    }
  }

  private async armTransactionTimeout(
    $prisma: TransactionPrismaClient,
  ): Promise<void> {
    // A non-zero server or role default starts its timer at BEGIN; 0 stops it, so the next value starts a new one.
    await $prisma.$executeRaw`SELECT set_config('transaction_timeout', '0', true)`;
    await $prisma.$executeRaw`SELECT set_config('transaction_timeout', ${String(this.remainingTimeoutMs())}, true)`;
    this.transactionTimeoutArmed = true;
  }

  private startWatchdog(backendPid: number): void {
    this.watchdog = setTimeout(() => {
      this.watchdogFired = true;
      this.cancellation = this.cancelBackend(backendPid);
    }, this.remainingTimeoutMs());
  }

  private async watched<T>(body: () => Promise<T>): Promise<T> {
    try {
      return await body();
    } finally {
      clearTimeout(this.watchdog);
      await this.cancellation;
    }
  }

  private async cancelBackend(backendPid: number): Promise<void> {
    try {
      await this.prismaService
        .$executeRaw`SELECT pg_cancel_backend(${backendPid}::int)`;
    } catch (error) {
      logger.warn(
        `Could not cancel backend ${backendPid} at the operation deadline: ${String(error)}`,
      );
    }
  }

  private endedOperation(error: unknown): boolean {
    const sqlState = sqlStateOf(error);

    return (
      errorCodeOf(error) === PRISMA_TRANSACTION_EXPIRED ||
      sqlState === TRANSACTION_TIMEOUT_TERMINATION ||
      (sqlState === QUERY_CANCELED && this.watchdogFired) ||
      (this.transactionTimeoutArmed &&
        this.hasPassed() &&
        isConnectionLost(error))
    );
  }

  private hasPassed(): boolean {
    return performance.now() >= this.endsAt;
  }

  private remainingTimeoutMs(): number {
    return Math.max(
      Math.ceil(this.endsAt - performance.now()),
      SMALLEST_TIMEOUT_MS,
    );
  }
}

async function readBackendPid(
  $prisma: TransactionPrismaClient,
): Promise<number> {
  const [session] = await $prisma.$queryRaw<
    [{ backendPid: number }]
  >`SELECT pg_backend_pid() AS "backendPid"`;

  return session.backendPid;
}
