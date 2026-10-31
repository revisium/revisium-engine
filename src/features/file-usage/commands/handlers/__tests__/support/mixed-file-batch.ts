import { randomUUID } from 'node:crypto';
import { nanoid } from 'nanoid';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import type {
  RegisterFileReferencesForRowsCommandData,
  RegisterFileReferencesRowInput,
} from 'src/features/file-usage/commands/impl/register-file-references-for-rows.command';
import {
  createRowDirect,
  givenBranchWithFileTable,
  makePendingFileValue,
  makeUploadedFileValue,
  setProjectFileBytes,
} from 'src/features/file-usage/commands/handlers/__tests__/utils';
import { totalSize } from 'src/features/file-usage/commands/handlers/__tests__/support/file-usage-state';

const FILE_SIZES = {
  new: 100,
  tombstoned: 200,
  active: 300,
  kept: 400,
  lost: 500,
};

export type UploadedFile = ReturnType<typeof makeUploadedFileValue>;

export type FileTable = Awaited<ReturnType<typeof givenBranchWithFileTable>>;

export interface FileMix {
  files: Record<keyof typeof FILE_SIZES, UploadedFile>;
  rows: {
    withNewFile: string;
    withNewAndTombstonedFiles: string;
    withActiveFile: string;
    losingFile: string;
    withoutFiles: string;
  };
}

export interface MixedFileBatch {
  projectId: string;
  command: RegisterFileReferencesForRowsCommandData;
}

export async function givenOneMixOfFiles(
  kit: DraftTestKit,
): Promise<MixedFileBatch & FileMix> {
  const table = await givenBranchWithFileTable(kit);
  const { mix, rows } = await givenFileMix(kit, table);
  await billActiveBlobs(kit, table, [mix]);

  return { ...batchOf(table, rows), ...mix };
}

export async function givenMixedFileBatch(
  kit: DraftTestKit,
  { rowCount }: { rowCount: number },
): Promise<MixedFileBatch> {
  const table = await givenBranchWithFileTable(kit);
  const mixes: FileMix[] = [];
  const rows: RegisterFileReferencesRowInput[] = [];

  while (rows.length < rowCount) {
    const mix = await givenFileMix(kit, table);
    mixes.push(mix.mix);
    rows.push(...mix.rows);
  }

  await billActiveBlobs(kit, table, mixes);

  return batchOf(table, rows.slice(0, rowCount));
}

export function uploadedFile(size: number): UploadedFile {
  return makeUploadedFileValue(randomUUID(), size);
}

export async function givenRowWithFiles(
  kit: DraftTestKit,
  table: FileTable,
  data: { file: object; gallery: object[] },
): Promise<RegisterFileReferencesRowInput> {
  const rowId = `row-${nanoid()}`;
  const rowVersionId = await createRowDirect(kit, {
    draftTableVersionId: table.draftTableVersionId,
    rowId,
    data,
  });

  return { rowId, rowVersionId, data };
}

export async function givenTombstonedBlob(
  kit: DraftTestKit,
  projectId: string,
  file: UploadedFile,
): Promise<void> {
  await kit.prismaService.fileBlob.create({
    data: {
      projectId,
      hash: file.hash,
      size: file.size,
      deletedAt: new Date(),
    },
  });
}

async function givenFileMix(
  kit: DraftTestKit,
  table: FileTable,
): Promise<{ mix: FileMix; rows: RegisterFileReferencesRowInput[] }> {
  const files = {
    new: uploadedFile(FILE_SIZES.new),
    tombstoned: uploadedFile(FILE_SIZES.tombstoned),
    active: uploadedFile(FILE_SIZES.active),
    kept: uploadedFile(FILE_SIZES.kept),
    lost: uploadedFile(FILE_SIZES.lost),
  };

  await givenTombstonedBlob(kit, table.projectId, files.tombstoned);
  await givenBlobsLinkedToRow(kit, table, {
    rowVersionId: await givenRowOutsideBatch(kit, table, files.active),
    files: [files.active],
  });

  const rows = {
    withNewFile: await givenRowWithFiles(kit, table, {
      file: files.new,
      gallery: [],
    }),
    withNewAndTombstonedFiles: await givenRowWithFiles(kit, table, {
      file: files.new,
      gallery: [files.tombstoned],
    }),
    withActiveFile: await givenRowWithFiles(kit, table, {
      file: files.active,
      gallery: [],
    }),
    losingFile: await givenRowWithFiles(kit, table, {
      file: files.kept,
      gallery: [],
    }),
    withoutFiles: await givenRowWithFiles(kit, table, {
      file: makePendingFileValue(),
      gallery: [],
    }),
  };

  await givenBlobsLinkedToRow(kit, table, {
    rowVersionId: rows.losingFile.rowVersionId,
    files: [files.kept, files.lost],
  });

  return {
    mix: {
      files,
      rows: {
        withNewFile: rows.withNewFile.rowVersionId,
        withNewAndTombstonedFiles: rows.withNewAndTombstonedFiles.rowVersionId,
        withActiveFile: rows.withActiveFile.rowVersionId,
        losingFile: rows.losingFile.rowVersionId,
        withoutFiles: rows.withoutFiles.rowVersionId,
      },
    },
    rows: Object.values(rows),
  };
}

async function givenRowOutsideBatch(
  kit: DraftTestKit,
  table: FileTable,
  file: UploadedFile,
): Promise<string> {
  const row = await givenRowWithFiles(kit, table, { file, gallery: [] });

  return row.rowVersionId;
}

async function givenBlobsLinkedToRow(
  kit: DraftTestKit,
  table: FileTable,
  args: { rowVersionId: string; files: UploadedFile[] },
): Promise<void> {
  for (const file of args.files) {
    await kit.prismaService.fileBlob.create({
      data: {
        projectId: table.projectId,
        hash: file.hash,
        size: file.size,
        rows: { connect: { versionId: args.rowVersionId } },
      },
    });
  }
}

async function billActiveBlobs(
  kit: DraftTestKit,
  table: FileTable,
  mixes: FileMix[],
): Promise<void> {
  const activeFiles = mixes.flatMap(({ files }) => [
    files.active,
    files.kept,
    files.lost,
  ]);

  await setProjectFileBytes(kit, table.projectId, totalSize(...activeFiles));
}

function batchOf(
  table: FileTable,
  rows: RegisterFileReferencesRowInput[],
): MixedFileBatch {
  return {
    projectId: table.projectId,
    command: {
      revisionId: table.draftRevisionId,
      tableId: table.tableId,
      rows,
    },
  };
}
