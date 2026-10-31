import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { createBarrier } from 'src/__tests__/utils/barrier';
import type { RegisterFileReferencesForRowsCommandData } from 'src/features/file-usage/commands/impl/register-file-references-for-rows.command';
import {
  type FileTable,
  type UploadedFile,
  givenRowWithFiles,
  givenTombstonedBlob,
  uploadedFile,
} from 'src/features/file-usage/commands/handlers/__tests__/support/mixed-file-batch';
import { givenBranchWithFileTable } from 'src/features/file-usage/commands/handlers/__tests__/utils';

const RACED_FILE_SIZE = 700;
const HELD_TRANSACTION_TIMEOUT_MS = 10_000;

export interface FileRace {
  projectId: string;
  file: UploadedFile;
  rows: { first: string; second: string };
  registrations: {
    first: RegisterFileReferencesForRowsCommandData;
    second: RegisterFileReferencesForRowsCommandData;
  };
}

export async function givenTwoRowsReferencingNewFile(
  kit: DraftTestKit,
): Promise<FileRace> {
  const table = await givenBranchWithFileTable(kit);

  return givenTwoRowsReferencing(kit, table, uploadedFile(RACED_FILE_SIZE));
}

export async function givenTwoRowsReferencingTombstonedFile(
  kit: DraftTestKit,
): Promise<FileRace> {
  const table = await givenBranchWithFileTable(kit);
  const file = uploadedFile(RACED_FILE_SIZE);
  await givenTombstonedBlob(kit, table.projectId, file);

  return givenTwoRowsReferencing(kit, table, file);
}

export async function registerWhileAnotherRegistrationIsUncommitted(
  kit: DraftTestKit,
  registrations: {
    uncommitted: () => Promise<void>;
    contender: () => Promise<void>;
  },
): Promise<void> {
  const held = await holdUncommitted(kit, registrations.uncommitted);
  const contending = kit.transactionService.run(registrations.contender);

  try {
    await waitUntilBlockedBy(kit, held.backendPid, contending);
  } finally {
    await held.commit();
  }

  await contending;
}

async function givenTwoRowsReferencing(
  kit: DraftTestKit,
  table: FileTable,
  file: UploadedFile,
): Promise<FileRace> {
  const first = await givenRowWithFiles(kit, table, { file, gallery: [] });
  const second = await givenRowWithFiles(kit, table, { file, gallery: [] });
  const registrationOf = (row: typeof first) => ({
    revisionId: table.draftRevisionId,
    tableId: table.tableId,
    rows: [row],
  });

  return {
    projectId: table.projectId,
    file,
    rows: { first: first.rowVersionId, second: second.rowVersionId },
    registrations: {
      first: registrationOf(first),
      second: registrationOf(second),
    },
  };
}

async function holdUncommitted(
  kit: DraftTestKit,
  register: () => Promise<void>,
) {
  const barrier = createBarrier('The uncommitted registration');
  let backendPid = 0;
  const holding = kit.transactionService.run(
    async () => {
      await register();
      backendPid = await readBackendPid(kit);
      await barrier.arrive();
    },
    { timeout: HELD_TRANSACTION_TIMEOUT_MS },
  );

  await barrier.expectReachedBefore(holding);

  return {
    backendPid,
    async commit() {
      barrier.release();
      await holding;
    },
  };
}

async function waitUntilBlockedBy(
  kit: DraftTestKit,
  backendPid: number,
  contending: Promise<unknown>,
): Promise<void> {
  let isSettled = false;
  const markSettled = () => {
    isSettled = true;
  };
  contending.then(markSettled, markSettled);

  while (!(await isBlockedBy(kit, backendPid))) {
    if (isSettled) {
      throw new Error(
        'The contending registration settled without waiting for the uncommitted one',
      );
    }
  }
}

async function isBlockedBy(
  kit: DraftTestKit,
  backendPid: number,
): Promise<boolean> {
  const blocked = await kit.prismaService.$queryRaw<unknown[]>`
    SELECT 1 FROM pg_stat_activity
    WHERE ${backendPid}::int = ANY(pg_blocking_pids(pid))`;

  return blocked.length > 0;
}

async function readBackendPid(kit: DraftTestKit): Promise<number> {
  const [backend] = await kit.transactionService.getTransaction().$queryRaw<
    { pid: number }[]
  >`SELECT pg_backend_pid() AS pid`;

  return backend?.pid ?? 0;
}
