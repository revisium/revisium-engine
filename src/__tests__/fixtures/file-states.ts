import type { PrismaService } from 'src/infrastructure/database/prisma.service';

export type FileState = 'active' | 'tombstoned';

// The state of each file blob of a project, by its hash.
export async function readFileStates(
  kit: { readonly prisma: PrismaService },
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
