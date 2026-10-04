import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type { TransactionPrismaClient } from 'src/features/share/types';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { updateRowData } from './snapshot-database';

function pauseAfterRevisionRead(
  client: TransactionPrismaClient,
  onRead: () => void,
  resume: Promise<void>,
): () => void {
  const revisionDelegate = client.revision as unknown as {
    findMany: (
      args: Parameters<typeof client.revision.findMany>[0],
    ) => Promise<unknown[]>;
  };
  const originalFindMany = revisionDelegate.findMany.bind(revisionDelegate);
  revisionDelegate.findMany = async (args) => {
    const result = await originalFindMany(args);
    onRead();
    await resume;
    return result;
  };
  return () => {
    revisionDelegate.findMany = originalFindMany;
  };
}

export async function readSnapshotDuringDraftRowUpdate(
  transactions: TransactionPrismaService,
  prisma: PrismaService,
  readSnapshot: () => Promise<DraftChangesSnapshot>,
  rowVersionId: string,
): Promise<DraftChangesSnapshot> {
  let reachedRoleRead!: () => void;
  let releaseRoleRead!: () => void;
  const roleRead = new Promise<void>((resolve) => {
    reachedRoleRead = resolve;
  });
  const resume = new Promise<void>((resolve) => {
    releaseRoleRead = resolve;
  });
  const originalRun = transactions.run.bind(transactions);
  const runSpy = jest
    .spyOn(transactions, 'run')
    .mockImplementation((handler, options) =>
      originalRun(async (...args) => {
        const transaction = transactions.getTransaction();
        const restoreRevisionRead = pauseAfterRevisionRead(
          transaction,
          reachedRoleRead,
          resume,
        );
        try {
          return await handler(...args);
        } finally {
          restoreRevisionRead();
        }
      }, options),
    );
  const read = readSnapshot();
  try {
    const first = await Promise.race([
      roleRead.then(() => 'role-read' as const),
      read.then(
        () => 'completed-before-role-read' as const,
        (error) => Promise.reject(error),
      ),
    ]);
    if (first === 'completed-before-role-read') {
      throw new Error('Snapshot completed before reading revision roles.');
    }
    await updateRowData(prisma, rowVersionId, {
      nested: { value: 'concurrent' },
    });
    releaseRoleRead();
    return await read;
  } finally {
    releaseRoleRead();
    runSpy.mockRestore();
  }
}
