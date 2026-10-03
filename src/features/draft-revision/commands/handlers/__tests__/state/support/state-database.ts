import { nanoid } from 'nanoid';
import { Prisma } from 'src/__generated__/client';
import type { JsonValue } from 'src/engine-prisma-types';
import type {
  DraftRevisionState,
  DraftRevisionStateTable,
} from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import { PrismaService } from 'src/infrastructure/database/prisma.service';

export interface SeedRow {
  id?: string;
  createdId?: string;
  versionId?: string;
  readonly?: boolean;
  createdAt?: Date;
  publishedAt?: Date;
  data?: JsonValue;
  meta?: JsonValue;
  hash?: string;
  schemaHash?: string;
  fileBlobIds?: string[];
}
export interface SeedTable {
  id?: string;
  createdId?: string;
  versionId?: string;
  readonly?: boolean;
  createdAt?: Date;
  system?: boolean;
  rows?: SeedRow[];
}

export async function createBlob(prisma: PrismaService): Promise<string> {
  const id = nanoid();
  await prisma.fileBlob.create({
    data: {
      id,
      projectId: `project-${id}`,
      hash: `hash-${id}`,
      size: BigInt(1),
    },
  });
  return id;
}

export async function connectRevisionTables(
  prisma: PrismaService,
  revisionId: string,
  tableVersionIds: string[],
): Promise<void> {
  await prisma.revision.update({
    where: { id: revisionId },
    data: {
      tables: { connect: tableVersionIds.map((versionId) => ({ versionId })) },
    },
  });
}

export async function connectTableRow(
  prisma: PrismaService,
  tableVersionId: string,
  rowVersionId: string,
): Promise<void> {
  await prisma.table.update({
    where: { versionId: tableVersionId },
    data: { rows: { connect: { versionId: rowVersionId } } },
  });
}

export async function rowExists(
  prisma: PrismaService,
  versionId: string,
): Promise<boolean> {
  return Boolean(await prisma.row.count({ where: { versionId } }));
}

export async function tableExists(
  prisma: PrismaService,
  versionId: string,
): Promise<boolean> {
  return Boolean(await prisma.table.count({ where: { versionId } }));
}

export async function tableCreatedIdExists(
  prisma: PrismaService,
  createdId: string,
): Promise<boolean> {
  return Boolean(await prisma.table.count({ where: { createdId } }));
}

export async function blobExists(
  prisma: PrismaService,
  id: string,
): Promise<boolean> {
  return Boolean(await prisma.fileBlob.count({ where: { id } }));
}

export async function rowVersions(
  prisma: PrismaService,
  createdId: string,
): Promise<string[]> {
  const rows = await prisma.row.findMany({
    where: { createdId },
    select: { versionId: true },
  });
  return rows.map(({ versionId }) => versionId).sort();
}

export function countRows(
  prisma: PrismaService,
  createdIds: string[],
): Promise<number> {
  return prisma.row.count({ where: { createdId: { in: createdIds } } });
}

export function countTables(
  prisma: PrismaService,
  createdId: string,
): Promise<number> {
  return prisma.table.count({ where: { createdId } });
}

export async function seedTable(
  prisma: PrismaService,
  revisionId: string,
  input: SeedTable = {},
) {
  const createdAt = input.createdAt ?? new Date('2025-01-01T00:00:00.000Z');
  const tableRecord = {
    id: input.id ?? 'products',
    createdId: input.createdId ?? nanoid(),
    versionId: input.versionId ? `${input.versionId}-${nanoid()}` : nanoid(),
    readonly: input.readonly ?? false,
    createdAt,
    system: input.system ?? false,
  };
  const rows = [];
  for (const inputRow of input.rows ?? []) {
    const row = {
      id: inputRow.id ?? 'product-1',
      createdId: inputRow.createdId ?? nanoid(),
      versionId: inputRow.versionId
        ? `${inputRow.versionId}-${nanoid()}`
        : nanoid(),
      readonly: inputRow.readonly ?? false,
      createdAt: inputRow.createdAt ?? createdAt,
      publishedAt: inputRow.publishedAt ?? new Date('2025-02-01T00:00:00.000Z'),
      data: inputRow.data === undefined ? { title: 'Original' } : inputRow.data,
      meta: inputRow.meta === undefined ? {} : inputRow.meta,
      hash: inputRow.hash ?? 'data-hash',
      schemaHash: inputRow.schemaHash ?? 'schema-hash',
      fileBlobIds: inputRow.fileBlobIds ?? [],
    };
    const { fileBlobIds, ...rowData } = row;
    await prisma.row.create({
      data: {
        ...rowData,
        data: row.data === null ? Prisma.JsonNull : (row.data as object),
        meta: row.meta === null ? Prisma.JsonNull : (row.meta as object),
        fileBlobs: { connect: fileBlobIds.map((id) => ({ id })) },
      },
    });
    rows.push(row);
  }
  await prisma.table.create({
    data: {
      ...tableRecord,
      rows: { connect: rows.map(({ versionId }) => ({ versionId })) },
      revisions: { connect: { id: revisionId } },
    },
  });
  return {
    versionId: tableRecord.versionId,
    rows: rows.map(({ versionId }) => ({ versionId })),
  };
}

export async function seedState(
  prisma: PrismaService,
  revisionId: string,
  ...tables: DraftRevisionStateTable[]
): Promise<void> {
  for (const table of tables) {
    await seedTable(prisma, revisionId, {
      ...table,
      rows: table.rows.map(({ fileBlobs, ...row }) => ({
        ...row,
        fileBlobIds: fileBlobs.map(({ id }) => id),
      })),
    });
  }
}

export async function readState(
  prisma: PrismaService,
  revisionId: string,
): Promise<DraftRevisionState> {
  const tables = await prisma.revision
    .findUniqueOrThrow({ where: { id: revisionId } })
    .tables({
      orderBy: { versionId: 'asc' },
      include: {
        rows: {
          orderBy: { versionId: 'asc' },
          include: {
            fileBlobs: { select: { id: true }, orderBy: { id: 'asc' } },
          },
        },
      },
    });
  return { tables };
}
