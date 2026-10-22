import type { PrismaService } from 'src/infrastructure/database/prisma.service';

export type CommittedVersions = {
  revisionTables: Record<string, string[]>;
  tableRows: Record<string, string[]>;
  tables: Record<string, unknown>;
  rows: Record<string, unknown>;
};

export async function readCommittedVersions(
  prisma: PrismaService,
  branchId: string,
): Promise<CommittedVersions> {
  const revisions = await prisma.revision.findMany({
    where: { branchId, isDraft: false },
    select: { id: true, tables: { select: { versionId: true } } },
  });

  const revisionTables = Object.fromEntries(
    revisions.map((revision) => [
      revision.id,
      revision.tables.map((table) => table.versionId).sort(),
    ]),
  );

  const tableVersionIds = [
    ...new Set(Object.values(revisionTables).flat()),
  ].sort();

  const tables = await prisma.table.findMany({
    where: { versionId: { in: tableVersionIds } },
    include: { rows: { select: { versionId: true } } },
  });

  const tableRows = Object.fromEntries(
    tables.map((table) => [
      table.versionId,
      table.rows.map((row) => row.versionId).sort(),
    ]),
  );

  const rowVersionIds = [...new Set(Object.values(tableRows).flat())];
  const rows = await prisma.row.findMany({
    where: { versionId: { in: rowVersionIds } },
    include: { fileBlobs: { select: { id: true }, orderBy: { id: 'asc' } } },
  });

  return {
    revisionTables,
    tableRows,
    tables: Object.fromEntries(
      tables.map(({ rows: _rows, ...table }) => [table.versionId, table]),
    ),
    rows: Object.fromEntries(rows.map((row) => [row.versionId, row])),
  };
}

export function expectVersionsPreserved(
  before: CommittedVersions,
  after: CommittedVersions,
): void {
  for (const [revisionId, tableVersionIds] of Object.entries(
    before.revisionTables,
  )) {
    expect(after.revisionTables[revisionId]).toEqual(tableVersionIds);
  }

  for (const [tableVersionId, rowVersionIds] of Object.entries(
    before.tableRows,
  )) {
    expect(after.tableRows[tableVersionId]).toEqual(rowVersionIds);
    expect(after.tables[tableVersionId]).toEqual(before.tables[tableVersionId]);
  }

  for (const [rowVersionId, row] of Object.entries(before.rows)) {
    expect(after.rows[rowVersionId]).toEqual(row);
  }
}
