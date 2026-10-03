import { sql } from 'src/engine-prisma-types';
import type { RowChangesScenario } from './row-scenario';

export async function persistedState(f: RowChangesScenario) {
  const branch = await f.snapshot();
  const tableIds = [
    ...new Set(
      branch.revisions.flatMap((revision) =>
        revision.tables.map((table) => table.createdId),
      ),
    ),
  ];
  const rowIds = [
    ...new Set(
      branch.revisions.flatMap((revision) =>
        revision.tables.flatMap((table) =>
          table.rows.map((row) => row.createdId),
        ),
      ),
    ),
  ];
  const prisma = f.kit.prismaService;
  const [tables, rows, blobs, usage, receipts] = await Promise.all([
    prisma.table.findMany({
      where: { createdId: { in: tableIds } },
      orderBy: { versionId: 'asc' },
    }),
    prisma.row.findMany({
      where: { createdId: { in: rowIds } },
      orderBy: { versionId: 'asc' },
      include: { fileBlobs: { orderBy: { id: 'asc' } } },
    }),
    prisma.fileBlob.findMany({
      where: { projectId: f.branch.projectId },
      orderBy: { id: 'asc' },
    }),
    prisma.projectFileUsage.findUnique({
      where: { projectId: f.branch.projectId },
    }),
    prisma.$queryRaw<unknown[]>(
      sql`SELECT * FROM "DraftChangesReceipt" WHERE "branchId" = ${f.initial.branchId} ORDER BY "requestId"`,
    ),
  ]);
  return { branch, tables, rows, blobs, usage, receipts };
}

export async function rowVersion(
  f: RowChangesScenario,
  role: 'head' | 'draft',
  rowId = f.rowId,
) {
  const revisionId = await f.revisionId(role);
  return f.kit.prismaService.row.findFirstOrThrow({
    where: {
      id: rowId,
      tables: {
        some: { id: f.tableId, revisions: { some: { id: revisionId } } },
      },
    },
  });
}
