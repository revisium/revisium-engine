import { Injectable } from '@nestjs/common';
import { Sql, sql } from 'src/engine-prisma-types';
import { TransactionPrismaClient } from 'src/features/share/types';
import { BranchWriteFencedException } from 'src/infrastructure/database/branch-write-fenced.exception';
import { sqlStateOf } from 'src/infrastructure/database/database-errors';
import { ExclusiveFenceHolder } from 'src/infrastructure/database/exclusive-fence-holder';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

// The wait and the admitted write share one transaction timeout: a writer that
// waits at most half of it keeps the other half for its write, so the wait ends
// with BranchWriteFencedException and never with Prisma's transaction timeout.
const WAIT_PART_OF_TRANSACTION_TIMEOUT = 0.5;

const LOCK_NOT_AVAILABLE = '55P03';

// PostgreSQL reads a lock_timeout of 0 as "no timeout", so a spent wait budget still sets the smallest one.
const SMALLEST_LOCK_TIMEOUT_MS = 1;

export function branchWriteFenceKey(branchId: string | Sql): Sql {
  return sql`hashtextextended(${branchId}, hashtext('branch-write-fence'))`;
}

@Injectable()
export class BranchWriteFenceService {
  public readonly waitLimitMs: number;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly transactionService: TransactionPrismaService,
  ) {
    this.waitLimitMs = Math.ceil(
      transactionService.serializableTimeoutMs *
        WAIT_PART_OF_TRANSACTION_TIMEOUT,
    );
  }

  async enterSharedForRevision(revisionId: string): Promise<void> {
    if (await this.isAdmittedByExclusiveHolder(revisionId)) {
      return;
    }

    await this.lockWithinWaitLimit(
      this.transactionService.getTransaction(),
      sql`pg_advisory_xact_lock_shared(${branchWriteFenceKey(branchOfRevision(revisionId))})`,
      this.waitLimitMs,
    );
  }

  exclusiveHolder(
    branchId: string,
    protectedTransactionTimeoutMs: number,
  ): ExclusiveFenceHolder {
    return new ExclusiveFenceHolder(
      this.prismaService,
      (holder, lockWaitMs) =>
        this.lockWithinWaitLimit(
          holder,
          sql`pg_advisory_xact_lock(${branchWriteFenceKey(branchId)})`,
          lockWaitMs,
        ),
      {
        maxWait: this.transactionService.serializableMaxWaitMs,
        protectedTransactionTimeoutMs,
      },
    );
  }

  private async isAdmittedByExclusiveHolder(
    revisionId: string,
  ): Promise<boolean> {
    const heldBranchId = this.transactionService.exclusiveHeldBranchId;

    if (heldBranchId === undefined) {
      return false;
    }

    const revision = await this.transactionService
      .getTransaction()
      .revision.findUnique({
        where: { id: revisionId },
        select: { branchId: true },
      });

    return revision?.branchId === heldBranchId;
  }

  private async lockWithinWaitLimit(
    transaction: TransactionPrismaClient,
    fenceLock: Sql,
    lockTimeoutMs: number,
  ): Promise<void> {
    try {
      await this.lockRestoringLockTimeout(
        transaction,
        fenceLock,
        Math.max(lockTimeoutMs, SMALLEST_LOCK_TIMEOUT_MS),
      );
    } catch (error) {
      if (isLockNotAvailable(error)) {
        throw new BranchWriteFencedException(this.waitLimitMs);
      }

      throw error;
    }
  }

  private async lockRestoringLockTimeout(
    transaction: TransactionPrismaClient,
    fenceLock: Sql,
    lockTimeoutMs: number,
  ): Promise<void> {
    // Each MATERIALIZED step reads the row of the step before it, which fixes the order:
    // the wait limit bounds only the fence wait and the previous lock_timeout comes back after it.
    await transaction.$executeRaw`
      WITH previous AS MATERIALIZED (
        SELECT current_setting('lock_timeout') AS lock_timeout
      ),
      wait_limit AS MATERIALIZED (
        SELECT set_config('lock_timeout', ${String(lockTimeoutMs)}, true)
        FROM previous
      ),
      fence AS MATERIALIZED (
        SELECT ${fenceLock}
        FROM wait_limit
      )
      SELECT set_config('lock_timeout', previous.lock_timeout, true)
      FROM previous, fence`;
  }
}

function branchOfRevision(revisionId: string): Sql {
  return sql`(SELECT "branchId" FROM "Revision" WHERE "id" = ${revisionId})`;
}

function isLockNotAvailable(error: unknown): boolean {
  return sqlStateOf(error) === LOCK_NOT_AVAILABLE;
}
