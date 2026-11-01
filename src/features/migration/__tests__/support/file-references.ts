import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';
import type { MigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';
import { FileUsageApiService } from 'src/features/file-usage/file-usage-api.service';
import { FileStatus, ID_LENGTH } from 'src/features/plugin/file/consts';
import { readRows } from './revision-records';

type FileState = 'active' | 'tombstoned';

interface TableInRevision {
  revisionId: string;
  tableId: string;
}

export function uploadedFileOf(content: string) {
  return {
    status: FileStatus.uploaded,
    fileId: nanoid(ID_LENGTH),
    url: '',
    fileName: 'attachment.txt',
    hash: createHash('sha256').update(content).digest('hex'),
    extension: 'txt',
    mimeType: 'text/plain',
    size: Buffer.byteLength(content),
    width: 0,
    height: 0,
  };
}

export async function expectRowsToLinkTheirFiles(
  kit: MigrationTestKit,
  table: TableInRevision,
  field: string,
): Promise<void> {
  const rows = await readRows(kit, table);

  expect(
    rows.map((row) => ({
      rowId: row.id,
      files: row.fileBlobs.map(({ hash }) => hash),
    })),
  ).toEqual(
    rows.map((row) => ({
      rowId: row.id,
      files: [fileHashOf(row.data, field)],
    })),
  );
}

export async function readLinkedFilesOfTableVersion(
  kit: MigrationTestKit,
  tableVersionId: string | null,
): Promise<{ rowId: string; files: string[] }[]> {
  if (!tableVersionId) {
    return [];
  }

  const rows = await kit.prisma.row.findMany({
    where: { tables: { some: { versionId: tableVersionId } } },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      fileBlobs: { orderBy: { hash: 'asc' }, select: { hash: true } },
    },
  });

  return rows.map((row) => ({
    rowId: row.id,
    files: row.fileBlobs.map(({ hash }) => hash),
  }));
}

export async function countFileLinks(
  kit: MigrationTestKit,
  projectId: string,
): Promise<number> {
  const blobs = await kit.prisma.fileBlob.findMany({
    where: { projectId },
    select: { _count: { select: { rows: true } } },
  });

  return blobs.reduce((links, blob) => links + blob._count.rows, 0);
}

export function readProjectFileBytes(
  kit: MigrationTestKit,
  projectId: string,
): Promise<bigint> {
  return kit.module
    .get(FileUsageApiService)
    .getProjectStorageBytes({ projectId });
}

export async function readFileStates(
  kit: MigrationTestKit,
  projectId: string,
): Promise<Record<string, FileState>> {
  const blobs = await kit.prisma.fileBlob.findMany({
    where: { projectId },
    select: { hash: true, deletedAt: true },
  });

  return Object.fromEntries(
    blobs.map(({ hash, deletedAt }) => [
      hash,
      deletedAt ? 'tombstoned' : 'active',
    ]),
  );
}

function fileHashOf(data: unknown, field: string): string {
  const file = (data as Record<string, { hash?: string } | undefined>)[field];

  if (!file?.hash) {
    throw new Error(`The row holds no uploaded file in "${field}"`);
  }

  return file.hash;
}
