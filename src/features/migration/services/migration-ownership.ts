import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type { Prisma } from 'src/__generated__/client';
import type { MigrationRecoveryScope } from 'src/features/migration/services/migration-recovery-scope';
import { MigrationStatus } from 'src/features/migration/types/migration.types';
import type { PrismaService } from 'src/infrastructure/database/prisma.service';

export interface MigrationLease {
  migrationId: string;
  token: string;
}

const WORKER_ID = `${hostname()}-${process.pid}`;

const SWAP_STALLED =
  'SWAP_STALLED: the swap did not complete within maxRetries claims and takeovers';

export const RELEASED = { lockedBy: null, lockedAt: null };

export function newLease(migrationId: string): MigrationLease {
  return { migrationId, token: `${WORKER_ID}-${randomUUID()}` };
}

export function ownedBy(lease: MigrationLease) {
  const now = new Date();

  return { lockedBy: lease.token, lockedAt: now, heartbeatAt: now };
}

export function inRecoveryScope(
  recoveryScope: MigrationRecoveryScope,
): Prisma.TableMigrationWhereInput {
  const migrationIds = recoveryScope.restrictedTo();

  return migrationIds ? { id: { in: [...migrationIds] } } : {};
}

export async function replaceSwapOwner(
  prisma: PrismaService,
  owner: Prisma.TableMigrationWhereInput,
  lease: MigrationLease,
): Promise<MigrationLease | null> {
  const replaced = await prisma.tableMigration.updateMany({
    where: {
      ...owner,
      retryCount: { lt: prisma.tableMigration.fields.maxRetries },
    },
    data: { ...ownedBy(lease), retryCount: { increment: 1 } },
  });

  if (replaced.count === 1) {
    return lease;
  }

  await failStalledSwap(prisma, owner);
  return null;
}

async function failStalledSwap(
  prisma: PrismaService,
  owner: Prisma.TableMigrationWhereInput,
): Promise<void> {
  await prisma.tableMigration.updateMany({
    where: {
      ...owner,
      retryCount: { gte: prisma.tableMigration.fields.maxRetries },
    },
    data: {
      status: MigrationStatus.FAILED,
      errorMessage: SWAP_STALLED,
      completedAt: new Date(),
      ...RELEASED,
    },
  });
}
