import { nanoid } from 'nanoid';
import type { MigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';
import { createMigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';
import {
  prepareBranch,
  type BranchGraph,
} from 'src/__tests__/utils/prepareProject';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import { TransactionIsolationLevel } from 'src/engine-prisma-types';
import type { TransactionPrismaClient } from 'src/features/share/types';

const blobSize = 7;

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

export interface SnapshotScenario {
  branch: BranchGraph;
  seedState(): Promise<{
    headRowVersionId: string;
    draftRowVersionId: string;
    blobId: string;
  }>;
  readSnapshot(): Promise<DraftChangesSnapshot>;
  readPersistedRevision(revisionId: string): Promise<unknown>;
  readBranch(): Promise<unknown>;
  readPersistedState(): Promise<unknown>;
  renameBranchAndCheckUncommittedLock(): Promise<void>;
  readSnapshotAfterUncommittedMigration(
    status: string,
  ): Promise<DraftChangesSnapshot>;
  transitionMigrationAndReadSnapshot(
    migrationId: string,
    status: string,
  ): Promise<DraftChangesSnapshot>;
  readSnapshotAfterOwnRowUpdate(
    rowVersionId: string,
    isolationLevel: TransactionIsolationLevel,
  ): Promise<{ first: DraftChangesSnapshot; second: DraftChangesSnapshot }>;
  createMigration(status: string): Promise<{ id: string }>;
  removeHeadRole(): Promise<void>;
  markDraftAsHead(): Promise<void>;
  removeDraftParent(): Promise<void>;
  removeDraftRole(): Promise<void>;
  markHeadAsDraft(): Promise<void>;
  markHeadAlsoDraft(): Promise<void>;
}

export async function createDraftChangesSnapshotTestKit() {
  const kit: MigrationTestKit = await createMigrationTestKit();
  return {
    ...kit,
    async givenBranch(
      projectId?: string,
      branchName?: string,
    ): Promise<SnapshotScenario> {
      const branch = await prepareBranch(kit.prisma);
      if (projectId || branchName) {
        await kit.prisma.branch.update({
          where: { id: branch.branchId },
          data: {
            projectId: projectId ?? branch.projectId,
            name: branchName ?? branch.branchName,
          },
        });
        branch.projectId = projectId ?? branch.projectId;
        branch.branchName = branchName ?? branch.branchName;
      }
      return {
        branch,
        async seedState() {
          const blobId = nanoid();
          const headTableVersionId = nanoid();
          const draftTableVersionId = nanoid();
          const headRowVersionId = nanoid();
          const draftRowVersionId = nanoid();
          await kit.prisma.fileBlob.create({
            data: {
              id: blobId,
              projectId: branch.projectId,
              hash: `hash-${blobId}`,
              size: BigInt(blobSize),
            },
          });
          await kit.prisma.table.create({
            data: {
              id: 'products',
              createdId: 'products-created',
              versionId: headTableVersionId,
              readonly: true,
              system: false,
              revisions: { connect: { id: branch.headRevisionId } },
            },
          });
          await kit.prisma.table.create({
            data: {
              id: 'products',
              createdId: 'products-created',
              versionId: draftTableVersionId,
              readonly: false,
              system: false,
              revisions: { connect: { id: branch.draftRevisionId } },
            },
          });
          await kit.prisma.row.create({
            data: {
              id: 'product-1',
              createdId: 'product-created',
              versionId: headRowVersionId,
              readonly: true,
              data: { nested: { value: 'head' } },
              meta: { source: 'head' },
              hash: 'same-stored-hash',
              schemaHash: 'same-schema-hash',
              tables: { connect: { versionId: headTableVersionId } },
            },
          });
          await kit.prisma.row.create({
            data: {
              id: 'product-1',
              createdId: 'product-created',
              versionId: draftRowVersionId,
              readonly: false,
              data: { nested: { value: 'draft' } },
              meta: { source: 'draft' },
              hash: 'same-stored-hash',
              schemaHash: 'same-schema-hash',
              fileBlobs: { connect: { id: blobId } },
              tables: { connect: { versionId: draftTableVersionId } },
            },
          });
          return { headRowVersionId, draftRowVersionId, blobId };
        },
        readSnapshot() {
          return kit.draftChangesApi.readSnapshot({
            projectId: branch.projectId,
            branchName: branch.branchName,
          });
        },
        async removeHeadRole() {
          await kit.prisma.revision.update({
            where: { id: branch.headRevisionId },
            data: { isHead: false },
          });
        },
        async markDraftAsHead() {
          await kit.prisma.revision.update({
            where: { id: branch.draftRevisionId },
            data: { isHead: true },
          });
        },
        async removeDraftParent() {
          await kit.prisma.revision.update({
            where: { id: branch.draftRevisionId },
            data: { parentId: null },
          });
        },
        async removeDraftRole() {
          await kit.prisma.revision.update({
            where: { id: branch.draftRevisionId },
            data: { isDraft: false },
          });
        },
        async markHeadAsDraft() {
          await kit.prisma.revision.update({
            where: { id: branch.headRevisionId },
            data: { isDraft: true },
          });
        },
        async markHeadAlsoDraft() {
          await kit.prisma.revision.update({
            where: { id: branch.headRevisionId },
            data: { isHead: false },
          });
          await kit.prisma.revision.update({
            where: { id: branch.draftRevisionId },
            data: { isHead: true },
          });
        },
        async readPersistedState() {
          const [persistedBranch, head, draft, migrations] = await Promise.all([
            kit.prisma.branch.findUniqueOrThrow({
              where: { id: branch.branchId },
            }),
            kit.prisma.revision.findUniqueOrThrow({
              where: { id: branch.headRevisionId },
              include: {
                tables: { include: { rows: { include: { fileBlobs: true } } } },
              },
            }),
            kit.prisma.revision.findUniqueOrThrow({
              where: { id: branch.draftRevisionId },
              include: {
                tables: { include: { rows: { include: { fileBlobs: true } } } },
              },
            }),
            kit.prisma.tableMigration.findMany({
              where: {
                revisionId: {
                  in: [branch.headRevisionId, branch.draftRevisionId],
                },
              },
            }),
          ]);
          return { branch: persistedBranch, head, draft, migrations };
        },
        async renameBranchAndCheckUncommittedLock() {
          const transactionBranchName = `transaction-${nanoid()}`;
          await kit.transactionService.run(async () => {
            await kit.transactionService.getTransaction().branch.update({
              where: { id: branch.branchId },
              data: { name: transactionBranchName },
            });
            await kit.transactionService
              .getTransaction()
              .tableMigration.create({
                data: {
                  revisionId: branch.draftRevisionId,
                  tableId: `branch-lock-${nanoid()}`,
                  sourceTableVersionId: 'source-v1',
                  status: 'PENDING',
                  phase: 'INIT',
                  patches: [],
                  previousSchema: {},
                  previousSchemaHash: 'old',
                  targetSchemaHash: 'new',
                  totalRows: 1,
                },
              });
            return kit.migrationLockService.checkBranchLock(
              branch.projectId,
              transactionBranchName,
            );
          });
        },
        async readSnapshotAfterUncommittedMigration(status) {
          return kit.transactionService.run(
            async () => {
              await kit.transactionService
                .getTransaction()
                .tableMigration.create({
                  data: {
                    revisionId: branch.draftRevisionId,
                    tableId: `snapshot-lock-${nanoid()}`,
                    sourceTableVersionId: 'source-v1',
                    status,
                    phase: status,
                    patches: [],
                    previousSchema: {},
                    previousSchemaHash: 'old',
                    targetSchemaHash: 'new',
                    totalRows: 1,
                  },
                });
              return kit.draftChangesApi.readSnapshot({
                projectId: branch.projectId,
                branchName: branch.branchName,
              });
            },
            { isolationLevel: TransactionIsolationLevel.RepeatableRead },
          );
        },
        async transitionMigrationAndReadSnapshot(migrationId, status) {
          return kit.transactionService.run(
            async () => {
              await kit.transactionService
                .getTransaction()
                .tableMigration.update({
                  where: { id: migrationId },
                  data: { status, phase: status },
                });
              return kit.draftChangesApi.readSnapshot({
                projectId: branch.projectId,
                branchName: branch.branchName,
              });
            },
            { isolationLevel: TransactionIsolationLevel.RepeatableRead },
          );
        },
        async readSnapshotAfterOwnRowUpdate(rowVersionId, isolationLevel) {
          return kit.transactionService.run(
            async () => {
              const first = await kit.draftChangesApi.readSnapshot({
                projectId: branch.projectId,
                branchName: branch.branchName,
              });
              await kit.transactionService.getTransaction().row.update({
                where: { versionId: rowVersionId },
                data: { data: { nested: { value: 'written in transaction' } } },
              });
              const second = await kit.draftChangesApi.readSnapshot({
                projectId: branch.projectId,
                branchName: branch.branchName,
              });
              return { first, second };
            },
            { isolationLevel },
          );
        },
        readPersistedRevision(revisionId) {
          return kit.prisma.revision.findUniqueOrThrow({
            where: { id: revisionId },
            include: {
              tables: { include: { rows: { include: { fileBlobs: true } } } },
            },
          });
        },
        readBranch() {
          return kit.prisma.branch.findUniqueOrThrow({
            where: { id: branch.branchId },
          });
        },
        async createMigration(status: string) {
          return kit.prisma.tableMigration.create({
            data: {
              revisionId: branch.draftRevisionId,
              tableId: 'products',
              sourceTableVersionId: 'source-v1',
              status,
              phase: status,
              patches: [],
              previousSchema: {},
              previousSchemaHash: 'old',
              targetSchemaHash: 'new',
              totalRows: 2,
            },
          });
        },
      };
    },
    async readSnapshotDuringDraftRowUpdate(
      scenario: SnapshotScenario,
      rowVersionId: string,
    ) {
      let reachedRoleRead!: () => void;
      let releaseRoleRead!: () => void;
      const roleRead = new Promise<void>((resolve) => {
        reachedRoleRead = resolve;
      });
      const resume = new Promise<void>((resolve) => {
        releaseRoleRead = resolve;
      });
      const originalRun = kit.transactionService.run.bind(
        kit.transactionService,
      );
      const runSpy = jest
        .spyOn(kit.transactionService, 'run')
        .mockImplementation((handler, options) =>
          originalRun(async (...args) => {
            const transaction = kit.transactionService.getTransaction();
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
      const read = scenario.readSnapshot();
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
        await kit.prisma.row.update({
          where: { versionId: rowVersionId },
          data: { data: { nested: { value: 'concurrent' } } },
        });
        releaseRoleRead();
        return await read;
      } finally {
        releaseRoleRead();
        runSpy.mockRestore();
      }
    },
    async insertMigrationInCurrentTransaction(
      revisionId: string,
      status: string,
    ) {
      return kit.transactionService.run(async () => {
        await kit.transactionService.getTransaction().tableMigration.create({
          data: {
            revisionId,
            tableId: `uncommitted-${nanoid()}`,
            sourceTableVersionId: 'source-v1',
            status,
            phase: status,
            patches: [],
            previousSchema: {},
            previousSchemaHash: 'old',
            targetSchemaHash: 'new',
            totalRows: 1,
          },
        });
        await kit.migrationApi.checkRevisionLock({ revisionId });
      });
    },
    async databaseInventory() {
      const [branches, revisions, tables, rows, blobs, migrations] =
        await Promise.all([
          kit.prisma.branch.count(),
          kit.prisma.revision.count(),
          kit.prisma.table.count(),
          kit.prisma.row.count(),
          kit.prisma.fileBlob.count(),
          kit.prisma.tableMigration.count(),
        ]);
      return { branches, revisions, tables, rows, blobs, migrations };
    },
  };
}
