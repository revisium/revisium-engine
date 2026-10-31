import { Injectable } from '@nestjs/common';
import { Sql, sql } from 'src/engine-prisma-types';
import { BranchWriteFencedException } from 'src/infrastructure/database/branch-write-fenced.exception';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

// The wait and the admitted write share one transaction timeout: a writer that
// waits at most half of it keeps the other half for its write, so the wait ends
// with BranchWriteFencedException and never with Prisma's transaction timeout.
const SHARED_WAIT_PART_OF_TRANSACTION_TIMEOUT = 0.5;

const LOCK_NOT_AVAILABLE = '55P03';

interface RawQueryFailure {
  meta?: { driverAdapterError?: { cause?: { originalCode?: string } } };
}

export function branchWriteFenceKey(branchId: string | Sql): Sql {
  return sql`hashtextextended(${branchId}, hashtext('branch-write-fence'))`;
}

@Injectable()
export class BranchWriteFenceService {
  private readonly sharedWaitLimitMs: number;

  constructor(private readonly transactionService: TransactionPrismaService) {
    this.sharedWaitLimitMs = Math.ceil(
      transactionService.serializableTimeoutMs *
        SHARED_WAIT_PART_OF_TRANSACTION_TIMEOUT,
    );
  }

  async enterSharedForRevision(revisionId: string): Promise<void> {
    try {
      await this.lockSharedWithinWaitLimit(branchOfRevision(revisionId));
    } catch (error) {
      if (isLockNotAvailable(error)) {
        throw new BranchWriteFencedException(this.sharedWaitLimitMs);
      }

      throw error;
    }
  }

  private async lockSharedWithinWaitLimit(branchId: Sql): Promise<void> {
    // Each MATERIALIZED step reads the row of the step before it, which fixes the order:
    // the wait limit bounds only the fence wait and the previous lock_timeout comes back after it.
    await this.transactionService.getTransaction().$executeRaw`
      WITH previous AS MATERIALIZED (
        SELECT current_setting('lock_timeout') AS lock_timeout
      ),
      wait_limit AS MATERIALIZED (
        SELECT set_config('lock_timeout', ${String(this.sharedWaitLimitMs)}, true)
        FROM previous
      ),
      fence AS MATERIALIZED (
        SELECT pg_advisory_xact_lock_shared(${branchWriteFenceKey(branchId)})
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
  const cause = (error as RawQueryFailure).meta?.driverAdapterError?.cause;

  return cause?.originalCode === LOCK_NOT_AVAILABLE;
}
