import type { PrismaService } from 'src/infrastructure/database/prisma.service';

export type DatabaseFootprint = Record<string, number>;

export async function readDatabaseFootprint(
  prisma: PrismaService,
): Promise<DatabaseFootprint> {
  const [counts] = await prisma.$queryRaw<DatabaseFootprint[]>`
    SELECT
      (SELECT count(*)::int FROM "Revision") AS "revisions",
      (SELECT count(*)::int FROM "Table") AS "tables",
      (SELECT count(*)::int FROM "Row") AS "rows",
      (SELECT count(*)::int FROM "_RevisionToTable") AS "revisionLinks",
      (SELECT count(*)::int FROM "_RowToTable") AS "rowLinks",
      (SELECT count(*)::int FROM "FileBlob") AS "fileBlobs",
      (SELECT count(*)::int FROM "FileBlob" WHERE "deletedAt" IS NULL) AS "activeFileBlobs",
      (SELECT count(*)::int FROM "_FileBlobToRow") AS "fileBlobLinks",
      (SELECT coalesce(sum("fileBytes"), 0)::float8 FROM "ProjectFileUsage") AS "fileBytes",
      (SELECT count(*)::int FROM "Revision" WHERE "isHead") AS "heads",
      (SELECT count(*)::int FROM "Revision" WHERE "hasChanges") AS "changedRevisions",
      (SELECT count(*)::int FROM "Row" WHERE "readonly") AS "readonlyRows"
  `;
  return counts ?? {};
}
