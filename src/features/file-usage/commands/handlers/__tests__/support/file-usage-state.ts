import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';

const ZERO_BYTES = 0n;

export type BlobState = 'active' | 'tombstoned';

interface FileLike {
  hash: string;
  size: number;
}

export async function loadLinkedHashes<RowName extends string>(
  kit: DraftTestKit,
  rowVersionIds: Record<RowName, string>,
): Promise<Record<RowName, string[]>> {
  const rows = await kit.prismaService.row.findMany({
    where: { versionId: { in: Object.values<string>(rowVersionIds) } },
    select: { versionId: true, fileBlobs: { select: { hash: true } } },
  });
  const hashesByVersion = new Map(
    rows.map((row) => [
      row.versionId,
      sortedHashes(row.fileBlobs.map((blob) => blob.hash)),
    ]),
  );

  return mapValues(
    rowVersionIds,
    (versionId) => hashesByVersion.get(versionId) ?? [],
  );
}

export async function loadBlobStates(
  kit: DraftTestKit,
  projectId: string,
): Promise<Record<string, BlobState>> {
  const blobs = await kit.prismaService.fileBlob.findMany({
    where: { projectId },
    select: { hash: true, deletedAt: true },
  });

  return Object.fromEntries(
    blobs.map((blob) => [
      blob.hash,
      blob.deletedAt === null ? 'active' : 'tombstoned',
    ]),
  );
}

export async function loadFileBytes(
  kit: DraftTestKit,
  projectId: string,
): Promise<bigint> {
  const usage = await kit.prismaService.projectFileUsage.findUnique({
    where: { projectId },
  });

  return usage?.fileBytes ?? ZERO_BYTES;
}

export function hashesOf(...files: FileLike[]): string[] {
  return sortedHashes(files.map((file) => file.hash));
}

export function totalSize(...files: FileLike[]): bigint {
  return files.reduce((total, file) => total + BigInt(file.size), ZERO_BYTES);
}

function sortedHashes(hashes: string[]): string[] {
  return [...hashes].sort((left, right) => left.localeCompare(right));
}

function mapValues<Key extends string, Value, Result>(
  record: Record<Key, Value>,
  map: (value: Value) => Result,
): Record<Key, Result> {
  return Object.fromEntries(
    Object.entries<Value>(record).map(([key, value]) => [key, map(value)]),
  ) as Record<Key, Result>;
}
