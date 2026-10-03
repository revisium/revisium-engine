import type {
  DraftRevisionState,
  DraftRevisionStateTable,
  DraftRevisionWriteStateCommandData,
} from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import { DraftRevisionApiService } from 'src/features/draft-revision/draft-revision-api.service';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import {
  createDraftRevisionTestingModule,
  prepareDraftRevisionTest,
} from '../../utils';
import {
  blobExists,
  connectRevisionTables,
  connectTableRow,
  countRows,
  countTables,
  createBlob,
  readState,
  rowExists,
  rowVersions,
  seedState,
  tableCreatedIdExists,
  tableExists,
} from './state-database';
import { candidateFrom, requireRow, requireTable } from './state-builders';
import {
  cleanupAfterRowRelink,
  withRowDeleteFailure,
  writeAfterCreatedRowDisappears,
} from './transaction-failures';

interface TestRuntime {
  prisma: PrismaService;
  transactions: TransactionPrismaService;
  api: DraftRevisionApiService;
}

export async function createDraftRevisionStateWriterTestKit() {
  const module = await createDraftRevisionTestingModule();
  const runtime: TestRuntime = {
    prisma: module.prismaService,
    transactions: module.transactionService,
    api: module.draftRevisionApiService,
  };
  return {
    given: (setup: StateSetup = {}) => createStateScenario(runtime, setup),
    close: () => module.module.close(),
  };
}

interface StateSetup {
  head?: DraftRevisionStateTable[];
  draft?: DraftRevisionStateTable[];
}

async function createStateScenario(runtime: TestRuntime, setup: StateSetup) {
  const revisions = await prepareDraftRevisionTest(runtime.prisma);
  await seedState(
    runtime.prisma,
    revisions.headRevisionId,
    ...(setup.head ?? []),
  );
  await seedState(
    runtime.prisma,
    revisions.draftRevisionId,
    ...(setup.draft ?? []),
  );
  const initialHead = await readState(runtime.prisma, revisions.headRevisionId);
  const initialDraft = await readState(
    runtime.prisma,
    revisions.draftRevisionId,
  );
  const writeTo = (
    revisionId: string,
    candidate: DraftRevisionState,
    sources: DraftRevisionWriteStateCommandData['sources'],
  ) =>
    runtime.transactions.run(() =>
      runtime.api.writeState({ revisionId, candidate, sources }),
    );
  const write = (
    candidate: DraftRevisionState,
    sources: DraftRevisionWriteStateCommandData['sources'] = {
      head: initialHead,
      others: [],
    },
  ) => writeTo(revisions.draftRevisionId, candidate, sources);
  const cleanup = (states: DraftRevisionState[]) =>
    runtime.transactions.run(() =>
      runtime.api.cleanupDetachedState({ states }),
    );

  return {
    ...revisions,
    initialHead,
    initialDraft,
    candidate: () => candidateFrom(initialDraft),
    row: (state: DraftRevisionState, tableIndex = 0, rowIndex = 0) =>
      requireRow(requireTable(state, tableIndex), rowIndex),
    table: (state: DraftRevisionState, index = 0) => requireTable(state, index),
    blob: () => createBlob(runtime.prisma),
    seedHead: (...tables: DraftRevisionStateTable[]) =>
      seedState(runtime.prisma, revisions.headRevisionId, ...tables),
    seedDraft: (...tables: DraftRevisionStateTable[]) =>
      seedState(runtime.prisma, revisions.draftRevisionId, ...tables),
    headState: () => readState(runtime.prisma, revisions.headRevisionId),
    draftState: () => readState(runtime.prisma, revisions.draftRevisionId),
    attachHeadTablesToDraft: async () => {
      const head = await readState(runtime.prisma, revisions.headRevisionId);
      return connectRevisionTables(
        runtime.prisma,
        revisions.draftRevisionId,
        head.tables.map(({ versionId }) => versionId),
      );
    },
    write,
    writeTo,
    cleanup,
    writeAndCleanupAtomically: (
      candidate: DraftRevisionState,
      states: DraftRevisionState[],
      sources: DraftRevisionWriteStateCommandData['sources'],
    ) =>
      runtime.transactions.run(async () => {
        await runtime.api.writeState({
          revisionId: revisions.draftRevisionId,
          candidate,
          sources,
        });
        return runtime.api.cleanupDetachedState({ states });
      }),
    hasRow: (versionId: string) => rowExists(runtime.prisma, versionId),
    hasTable: (versionId: string) => tableExists(runtime.prisma, versionId),
    hasTableCreatedId: (createdId: string) =>
      tableCreatedIdExists(runtime.prisma, createdId),
    hasBlob: (id: string) => blobExists(runtime.prisma, id),
    rowVersions: (createdId: string) => rowVersions(runtime.prisma, createdId),
    createdRows: (createdIds: string[]) =>
      countRows(runtime.prisma, createdIds),
    createdTableCount: (createdId: string) =>
      countTables(runtime.prisma, createdId),
    retainRowInTable: (tableVersionId: string, rowVersionId: string) =>
      connectTableRow(runtime.prisma, tableVersionId, rowVersionId),
    cleanupAfterRowRelink: (
      states: DraftRevisionState[],
      tableVersionId: string,
      rowVersionId: string,
    ) =>
      cleanupAfterRowRelink(
        runtime.transactions,
        tableVersionId,
        rowVersionId,
        () => runtime.api.cleanupDetachedState({ states }),
      ),
    writeAfterCreatedRowDisappears: (
      candidate: DraftRevisionState,
      sources: DraftRevisionWriteStateCommandData['sources'],
    ) =>
      writeAfterCreatedRowDisappears(runtime.transactions, () =>
        runtime.api.writeState({
          revisionId: revisions.draftRevisionId,
          candidate,
          sources,
        }),
      ),
    cleanupFailingOnRow: <T>(createdId: string, operation: () => Promise<T>) =>
      withRowDeleteFailure(runtime.prisma, createdId, operation),
  };
}
