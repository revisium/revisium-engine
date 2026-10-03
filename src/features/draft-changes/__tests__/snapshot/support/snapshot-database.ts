import { nanoid } from 'nanoid';
import type { Prisma } from 'src/__generated__/client';
import type { BranchGraph } from 'src/__tests__/utils/prepareProject';
import { prepareBranch } from 'src/__tests__/utils/prepareProject';
import { MigrationStatus } from 'src/features/migration/types/migration.types';
import { createMigrationRecord } from 'src/features/migration/__tests__/support/migration-database';
import { PrismaService } from 'src/infrastructure/database/prisma.service';

const blobSize = 7;

export async function createSnapshotBranch(
  prisma: PrismaService,
): Promise<BranchGraph> {
  return prepareBranch(prisma);
}

export async function updateRowData(
  database: Pick<PrismaService, 'row'>,
  rowVersionId: string,
  data: Prisma.InputJsonValue,
): Promise<void> {
  await database.row.update({
    where: { versionId: rowVersionId },
    data: { data },
  });
}

export async function seedSnapshotState(
  prisma: PrismaService,
  branch: BranchGraph,
) {
  const blobId = nanoid();
  const headTableVersionId = nanoid();
  const draftTableVersionId = nanoid();
  const headRowVersionId = nanoid();
  const draftRowVersionId = nanoid();
  await prisma.fileBlob.create({
    data: {
      id: blobId,
      projectId: branch.projectId,
      hash: `hash-${blobId}`,
      size: BigInt(blobSize),
    },
  });
  await prisma.table.create({
    data: {
      id: 'products',
      createdId: 'products-created',
      versionId: headTableVersionId,
      readonly: true,
      system: false,
      revisions: { connect: { id: branch.headRevisionId } },
    },
  });
  await prisma.table.create({
    data: {
      id: 'products',
      createdId: 'products-created',
      versionId: draftTableVersionId,
      readonly: false,
      system: false,
      revisions: { connect: { id: branch.draftRevisionId } },
    },
  });
  await prisma.row.create({
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
  await prisma.row.create({
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
}

export async function readPersistedRevision(
  prisma: PrismaService,
  revisionId: string,
) {
  return prisma.revision.findUniqueOrThrow({
    where: { id: revisionId },
    include: {
      tables: { include: { rows: { include: { fileBlobs: true } } } },
    },
  });
}

export function readBranch(prisma: PrismaService, branchId: string) {
  return prisma.branch.findUniqueOrThrow({ where: { id: branchId } });
}

export async function readPersistedState(
  prisma: PrismaService,
  branch: BranchGraph,
) {
  const [persistedBranch, head, draft, migrations, blobs] = await Promise.all([
    readBranch(prisma, branch.branchId),
    readPersistedRevision(prisma, branch.headRevisionId),
    readPersistedRevision(prisma, branch.draftRevisionId),
    prisma.tableMigration.findMany({
      where: {
        revisionId: { in: [branch.headRevisionId, branch.draftRevisionId] },
      },
      orderBy: { id: 'asc' },
    }),
    prisma.fileBlob.findMany({
      where: { projectId: branch.projectId },
      orderBy: { id: 'asc' },
    }),
  ]);
  return { branch: persistedBranch, head, draft, migrations, blobs };
}

export async function readDatabaseInventory(prisma: PrismaService) {
  const [branches, revisions, tables, rows, blobs, migrations] =
    await Promise.all([
      prisma.branch.count(),
      prisma.revision.count(),
      prisma.table.count(),
      prisma.row.count(),
      prisma.fileBlob.count(),
      prisma.tableMigration.count(),
    ]);
  return { branches, revisions, tables, rows, blobs, migrations };
}

export async function setRevisionRole(
  prisma: PrismaService,
  revisionId: string,
  values: { isHead?: boolean; isDraft?: boolean; parentId?: string | null },
): Promise<void> {
  await prisma.revision.update({ where: { id: revisionId }, data: values });
}

export function createMigration(
  prisma: PrismaService,
  revisionId: string,
  status: MigrationStatus | string,
) {
  return createMigrationRecord(prisma, revisionId, status, {
    tableId: 'products',
    totalRows: 2,
  });
}
