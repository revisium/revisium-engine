import { createDraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import type { BranchGraph } from 'src/__tests__/utils/prepareProject';
import { DraftChangesApiService } from 'src/features/draft-changes/draft-changes-api.service';
import { DraftChangesModule } from 'src/features/draft-changes/draft-changes.module';
import type {
  DraftChangesSnapshot,
  ReadDraftChangesSnapshotQueryData,
} from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import { MigrationStatus } from 'src/features/migration/types/migration.types';
import { TransactionIsolationLevel } from 'src/engine-prisma-types';
import {
  createMigrationRecord,
  setMigrationStatus,
} from 'src/features/migration/__tests__/support/migration-database';
import { readSnapshotDuringDraftRowUpdate } from './read-barrier';
import {
  createMigration,
  createSnapshotBranch,
  readBranch,
  readDatabaseInventory,
  readPersistedRevision,
  readPersistedState,
  seedSnapshotState,
  setRevisionRole,
  updateRowData,
} from './snapshot-database';

export interface SnapshotScenario {
  branch: BranchGraph;
  seedState(): ReturnType<typeof seedSnapshotState>;
  readSnapshot(): Promise<DraftChangesSnapshot>;
  readSnapshotAt(
    query: ReadDraftChangesSnapshotQueryData,
  ): Promise<DraftChangesSnapshot>;
  readPersistedRevision(
    revisionId: string,
  ): ReturnType<typeof readPersistedRevision>;
  readBranch(): ReturnType<typeof readBranch>;
  readPersistedState(): ReturnType<typeof readPersistedState>;
  databaseInventory(): ReturnType<typeof readDatabaseInventory>;
  readSnapshotInTransaction(
    isolationLevel: TransactionIsolationLevel,
  ): Promise<DraftChangesSnapshot>;
  readSnapshotAfterUncommittedMigration(
    status: MigrationStatus,
  ): Promise<DraftChangesSnapshot>;
  transitionMigrationAndReadSnapshot(
    migrationId: string,
    status: MigrationStatus,
  ): Promise<DraftChangesSnapshot>;
  readSnapshotAfterOwnRowUpdate(
    rowVersionId: string,
    isolationLevel: TransactionIsolationLevel,
  ): Promise<{ first: DraftChangesSnapshot; second: DraftChangesSnapshot }>;
  createMigration(status: MigrationStatus): ReturnType<typeof createMigration>;
  removeHeadRole(): Promise<void>;
  markDraftAsHead(): Promise<void>;
  removeDraftParent(): Promise<void>;
  removeDraftRole(): Promise<void>;
  markHeadAsDraft(): Promise<void>;
  markHeadAlsoDraft(): Promise<void>;
}

export async function createDraftChangesSnapshotTestKit() {
  const kit = await createDraftTestKit({ imports: [DraftChangesModule] });
  const runtime: SnapshotRuntime = {
    prisma: kit.prismaService,
    transactions: kit.transactionService,
    draftChangesApi: kit.module.get(DraftChangesApiService),
  };

  return {
    close: () => kit.close(),
    givenBranch: async () => {
      const branch = await createSnapshotBranch(runtime.prisma);
      return createSnapshotScenario(runtime, branch);
    },
    readSnapshotDuringDraftRowUpdate: (
      scenario: SnapshotScenario,
      rowVersionId: string,
    ) =>
      readSnapshotDuringDraftRowUpdate(
        runtime.transactions,
        runtime.prisma,
        scenario.readSnapshot,
        rowVersionId,
      ),
  };
}

interface SnapshotRuntime {
  prisma: Awaited<ReturnType<typeof createDraftTestKit>>['prismaService'];
  transactions: Awaited<
    ReturnType<typeof createDraftTestKit>
  >['transactionService'];
  draftChangesApi: DraftChangesApiService;
}

async function createSnapshotScenario(
  runtime: SnapshotRuntime,
  branch: BranchGraph,
): Promise<SnapshotScenario> {
  const readSnapshotWith = (
    overrides: Partial<ReadDraftChangesSnapshotQueryData> = {},
  ) =>
    runtime.draftChangesApi.readSnapshot({
      projectId: branch.projectId,
      branchName: branch.branchName,
      ...overrides,
    });

  return {
    branch,
    seedState: () => seedSnapshotState(runtime.prisma, branch),
    readSnapshot: () => readSnapshotWith(),
    readSnapshotAt: (query) => runtime.draftChangesApi.readSnapshot(query),
    readPersistedRevision: (revisionId) =>
      readPersistedRevision(runtime.prisma, revisionId),
    readBranch: () => readBranch(runtime.prisma, branch.branchId),
    readPersistedState: () => readPersistedState(runtime.prisma, branch),
    databaseInventory: () => readDatabaseInventory(runtime.prisma),
    readSnapshotInTransaction: (isolationLevel) =>
      runtime.transactions.run(() => readSnapshotWith(), { isolationLevel }),
    readSnapshotAfterUncommittedMigration: (status) =>
      runtime.transactions.run(
        async () => {
          await createMigrationRecord(
            runtime.transactions.getTransaction(),
            branch.draftRevisionId,
            status,
            { tableId: 'snapshot-lock' },
          );
          return readSnapshotWith();
        },
        { isolationLevel: TransactionIsolationLevel.RepeatableRead },
      ),
    transitionMigrationAndReadSnapshot: (migrationId, status) =>
      runtime.transactions.run(
        async () => {
          await setMigrationStatus(
            runtime.transactions.getTransaction(),
            migrationId,
            status,
          );
          return readSnapshotWith();
        },
        { isolationLevel: TransactionIsolationLevel.RepeatableRead },
      ),
    readSnapshotAfterOwnRowUpdate: (rowVersionId, isolationLevel) =>
      runtime.transactions.run(
        async () => {
          const first = await readSnapshotWith();
          await updateRowData(
            runtime.transactions.getTransaction(),
            rowVersionId,
            { nested: { value: 'written in transaction' } },
          );
          const second = await readSnapshotWith();
          return { first, second };
        },
        { isolationLevel },
      ),
    createMigration: (status) =>
      createMigration(runtime.prisma, branch.draftRevisionId, status),
    removeHeadRole: () =>
      setRevisionRole(runtime.prisma, branch.headRevisionId, { isHead: false }),
    markDraftAsHead: () =>
      setRevisionRole(runtime.prisma, branch.draftRevisionId, { isHead: true }),
    removeDraftParent: () =>
      setRevisionRole(runtime.prisma, branch.draftRevisionId, {
        parentId: null,
      }),
    removeDraftRole: () =>
      setRevisionRole(runtime.prisma, branch.draftRevisionId, {
        isDraft: false,
      }),
    markHeadAsDraft: () =>
      setRevisionRole(runtime.prisma, branch.headRevisionId, { isDraft: true }),
    markHeadAlsoDraft: async () => {
      await setRevisionRole(runtime.prisma, branch.headRevisionId, {
        isHead: false,
      });
      await setRevisionRole(runtime.prisma, branch.draftRevisionId, {
        isHead: true,
      });
    },
  };
}
