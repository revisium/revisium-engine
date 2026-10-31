import { performance } from 'node:perf_hooks';
import { TransactionPrismaClient } from 'src/features/share/types';

type LocalTimeout = 'transaction_timeout' | 'statement_timeout';

// PostgreSQL reads a timeout of 0 as "no timeout", so a passed deadline still sets the smallest one.
const SMALLEST_TIMEOUT_MS = 1;

export class OperationDeadline {
  private readonly endsAt: number;

  constructor(timeoutMs: number) {
    this.endsAt = performance.now() + timeoutMs;
  }

  public hasPassed(): boolean {
    return performance.now() >= this.endsAt;
  }

  public remainingMs(): number {
    return Math.max(Math.ceil(this.endsAt - performance.now()), 0);
  }
}

export async function setLocalTimeoutToDeadline(
  $prisma: TransactionPrismaClient,
  timeout: LocalTimeout,
  deadline: OperationDeadline,
): Promise<void> {
  const timeoutMs = Math.max(deadline.remainingMs(), SMALLEST_TIMEOUT_MS);

  await $prisma.$executeRaw`SELECT set_config(${timeout}, ${String(timeoutMs)}, true)`;
}
