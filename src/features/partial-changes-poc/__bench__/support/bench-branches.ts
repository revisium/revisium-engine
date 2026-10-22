import { nanoid } from 'nanoid';
import { sql, type Sql } from 'src/engine-prisma-types';
import type { PrismaService } from 'src/infrastructure/database/prisma.service';

export const BENCH_PROJECT_PREFIX = 'bench-';
const LONG_TRANSACTION = { timeout: 3_600_000, maxWait: 60_000 };
const SUFFIX_LENGTH = 6;

export interface BenchBranch {
  projectId: string;
  branchName: string;
  branchId: string;
  headRevisionId: string;
  draftRevisionId: string;
}

export async function findBenchBranch(
  prisma: PrismaService,
  projectId: string,
): Promise<BenchBranch | undefined> {
  const branch = await prisma.branch.findFirst({ where: { projectId } });
  if (!branch) {
    return undefined;
  }
  return loadBranch(prisma, branch.id);
}

export async function loadBranch(
  prisma: PrismaService,
  branchId: string,
): Promise<BenchBranch> {
  const branch = await prisma.branch.findUniqueOrThrow({
    where: { id: branchId },
  });
  const head = await prisma.revision.findFirstOrThrow({
    where: { branchId, isHead: true },
  });
  const draft = await prisma.revision.findFirstOrThrow({
    where: { branchId, isDraft: true },
  });
  return {
    projectId: branch.projectId,
    branchName: branch.name,
    branchId,
    headRevisionId: head.id,
    draftRevisionId: draft.id,
  };
}

export async function moveToProject(
  prisma: PrismaService,
  branchId: string,
  projectId: string,
): Promise<BenchBranch> {
  await prisma.branch.update({ where: { id: branchId }, data: { projectId } });
  return loadBranch(prisma, branchId);
}

export async function tableVersionId(
  prisma: PrismaService,
  revisionId: string,
  tableId: string,
): Promise<string> {
  const table = await prisma.table.findFirstOrThrow({
    where: { id: tableId, revisions: { some: { id: revisionId } } },
    select: { versionId: true },
  });
  return table.versionId;
}

export async function copyTableOnWrite(
  prisma: PrismaService,
  revisionId: string,
  tableId: string,
): Promise<string> {
  const previous = await tableVersionId(prisma, revisionId, tableId);
  const versionId = nanoid();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO "Table" ("versionId", "createdId", "id", "readonly", "system", "createdAt")
      SELECT ${versionId}, "createdId", "id", false, "system", "createdAt"
      FROM "Table" WHERE "versionId" = ${previous} AND "readonly"
    `;
    await tx.$executeRaw`
      INSERT INTO "_RowToTable" ("A", "B")
      SELECT "A", ${versionId} FROM "_RowToTable" WHERE "B" = ${previous}
    `;
    await tx.$executeRaw`
      DELETE FROM "_RevisionToTable" WHERE "A" = ${revisionId} AND "B" = ${previous}
    `;
    await tx.$executeRaw`
      INSERT INTO "_RevisionToTable" ("A", "B") VALUES (${revisionId}, ${versionId})
    `;
  }, LONG_TRANSACTION);
  return versionId;
}

export async function cloneBranch(
  prisma: PrismaService,
  source: BenchBranch,
  projectId: string,
): Promise<BenchBranch> {
  const branchId = `branch-${nanoid()}`;
  const headRevisionId = nanoid();
  const draftRevisionId = nanoid();
  const sourceDraft = await prisma.revision.findUniqueOrThrow({
    where: { id: source.draftRevisionId },
  });
  const mutableTables = await prisma.table.findMany({
    where: {
      readonly: false,
      revisions: { some: { id: source.draftRevisionId } },
    },
    select: { versionId: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.branch.create({
      data: { id: branchId, name: source.branchName, isRoot: true, projectId },
    });
    await tx.revision.create({
      data: {
        id: headRevisionId,
        branchId,
        isHead: true,
        isStart: true,
        hasChanges: false,
      },
    });
    await tx.revision.create({
      data: {
        id: draftRevisionId,
        branchId,
        parentId: headRevisionId,
        isDraft: true,
        hasChanges: sourceDraft.hasChanges,
      },
    });
    await tx.$executeRaw`
      INSERT INTO "_RevisionToTable" ("A", "B")
      SELECT ${headRevisionId}, rt."B" FROM "_RevisionToTable" rt
      WHERE rt."A" = ${source.headRevisionId}
    `;
    await tx.$executeRaw`
      INSERT INTO "_RevisionToTable" ("A", "B")
      SELECT ${draftRevisionId}, rt."B" FROM "_RevisionToTable" rt
      JOIN "Table" t ON t."versionId" = rt."B"
      WHERE rt."A" = ${source.draftRevisionId} AND t."readonly"
    `;

    for (const { versionId } of mutableTables) {
      const copyId = nanoid();
      await tx.$executeRaw`
        INSERT INTO "Table" ("versionId", "createdId", "id", "readonly", "createdAt", "updatedAt", "system")
        SELECT ${copyId}, "createdId", "id", false, "createdAt", "updatedAt", "system"
        FROM "Table" WHERE "versionId" = ${versionId}
      `;
      await tx.$executeRaw`
        INSERT INTO "_RevisionToTable" ("A", "B") VALUES (${draftRevisionId}, ${copyId})
      `;
      await tx.$executeRaw`
        WITH copied AS (
          INSERT INTO "Row" ("versionId", "createdId", "id", "readonly", "data", "meta", "hash",
                             "schemaHash", "createdAt", "updatedAt", "publishedAt")
          SELECT replace(gen_random_uuid()::text, '-', ''), r."createdId", r."id", false, r."data",
                 r."meta", r."hash", r."schemaHash", r."createdAt", r."updatedAt", r."publishedAt"
          FROM "_RowToTable" rt JOIN "Row" r ON r."versionId" = rt."A"
          WHERE rt."B" = ${versionId} AND NOT r."readonly"
          RETURNING "versionId"
        )
        INSERT INTO "_RowToTable" ("A", "B") SELECT "versionId", ${copyId} FROM copied
      `;
      await tx.$executeRaw`
        INSERT INTO "_RowToTable" ("A", "B")
        SELECT rt."A", ${copyId} FROM "_RowToTable" rt JOIN "Row" r ON r."versionId" = rt."A"
        WHERE rt."B" = ${versionId} AND r."readonly"
      `;
    }
  }, LONG_TRANSACTION);

  await analyze(prisma);
  await prisma.$executeRawUnsafe('CHECKPOINT');
  return loadBranch(prisma, branchId);
}

export async function dropProjects(
  prisma: PrismaService,
  pattern: string,
): Promise<void> {
  await dropBranchesWhere(prisma, sql`b."projectId" LIKE ${pattern}`);
  await prisma.$executeRaw`
    DELETE FROM "FileBlob" WHERE "projectId" LIKE ${pattern}
  `;
  await prisma.$executeRaw`
    DELETE FROM "ProjectFileUsage" WHERE "projectId" LIKE ${pattern}
  `;
}

export async function dropBranch(
  prisma: PrismaService,
  branchId: string,
): Promise<void> {
  await dropBranchesWhere(prisma, sql`b."id" = ${branchId}`);
}

async function dropBranchesWhere(
  prisma: PrismaService,
  branches: Sql,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      CREATE TEMP TABLE bench_branches ON COMMIT DROP AS
      SELECT b."id" FROM "Branch" b WHERE ${branches}
    `;
    await tx.$executeRaw`
      CREATE TEMP TABLE bench_revisions ON COMMIT DROP AS
      SELECT r."id" FROM "Revision" r JOIN bench_branches bb ON bb."id" = r."branchId"
    `;
    await tx.$executeRaw`
      CREATE TEMP TABLE bench_tables ON COMMIT DROP AS
      SELECT DISTINCT rt."B" AS "versionId" FROM "_RevisionToTable" rt
      JOIN bench_revisions br ON br."id" = rt."A"
    `;
    await tx.$executeRaw`
      DELETE FROM bench_tables bt USING "_RevisionToTable" rt
      WHERE rt."B" = bt."versionId"
        AND NOT EXISTS (SELECT 1 FROM bench_revisions br WHERE br."id" = rt."A")
    `;
    await tx.$executeRaw`
      CREATE TEMP TABLE bench_rows ON COMMIT DROP AS
      SELECT DISTINCT rt."A" AS "versionId" FROM "_RowToTable" rt
      JOIN bench_tables bt ON bt."versionId" = rt."B"
    `;
    await tx.$executeRaw`
      DELETE FROM bench_rows br USING "_RowToTable" rt
      WHERE rt."A" = br."versionId"
        AND NOT EXISTS (SELECT 1 FROM bench_tables bt WHERE bt."versionId" = rt."B")
    `;
    await tx.$executeRaw`
      DELETE FROM "TableMigration" tm USING bench_revisions br WHERE tm."revisionId" = br."id"
    `;
    await tx.$executeRaw`DELETE FROM "Branch" b USING bench_branches bb WHERE b."id" = bb."id"`;
    await tx.$executeRaw`
      DELETE FROM "Table" t USING bench_tables bt WHERE t."versionId" = bt."versionId"
    `;
    await tx.$executeRaw`
      DELETE FROM "Row" r USING bench_rows br WHERE r."versionId" = br."versionId"
    `;
  }, LONG_TRANSACTION);
}

export async function cloneBranchInProject(
  prisma: PrismaService,
  source: BenchBranch,
  branchName: string,
): Promise<BenchBranch> {
  const branchId = `branch-${nanoid()}`;
  const headRevisionId = nanoid();
  const draftRevisionId = nanoid();
  const sourceDraft = await prisma.revision.findUniqueOrThrow({
    where: { id: source.draftRevisionId },
  });
  const mutableTables = await prisma.table.findMany({
    where: {
      readonly: false,
      revisions: { some: { id: source.draftRevisionId } },
    },
    select: { versionId: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.branch.create({
      data: {
        id: branchId,
        name: branchName,
        isRoot: false,
        projectId: source.projectId,
      },
    });
    await tx.revision.create({
      data: {
        id: headRevisionId,
        branchId,
        isHead: true,
        isStart: true,
        hasChanges: false,
      },
    });
    await tx.revision.create({
      data: {
        id: draftRevisionId,
        branchId,
        parentId: headRevisionId,
        isDraft: true,
        hasChanges: sourceDraft.hasChanges,
      },
    });
    await tx.$executeRaw`
      INSERT INTO "_RevisionToTable" ("A", "B")
      SELECT ${headRevisionId}, rt."B" FROM "_RevisionToTable" rt
      WHERE rt."A" = ${source.headRevisionId}
    `;
    await tx.$executeRaw`
      INSERT INTO "_RevisionToTable" ("A", "B")
      SELECT ${draftRevisionId}, rt."B" FROM "_RevisionToTable" rt
      JOIN "Table" t ON t."versionId" = rt."B"
      WHERE rt."A" = ${source.draftRevisionId} AND t."readonly"
    `;
    for (const { versionId } of mutableTables) {
      await copyMutableTable(tx, versionId, draftRevisionId);
    }
  }, LONG_TRANSACTION);

  await analyze(prisma);
  await prisma.$executeRawUnsafe('CHECKPOINT');
  return loadBranch(prisma, branchId);
}

async function copyMutableTable(
  tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
  versionId: string,
  revisionId: string,
): Promise<void> {
  const copyId = nanoid();
  await tx.$executeRaw`
    INSERT INTO "Table" ("versionId", "createdId", "id", "readonly", "createdAt", "updatedAt", "system")
    SELECT ${copyId}, "createdId", "id", false, "createdAt", "updatedAt", "system"
    FROM "Table" WHERE "versionId" = ${versionId}
  `;
  await tx.$executeRaw`
    INSERT INTO "_RevisionToTable" ("A", "B") VALUES (${revisionId}, ${copyId})
  `;
  await tx.$executeRaw`
    WITH source AS MATERIALIZED (
      SELECT r.*, replace(gen_random_uuid()::text, '-', '') AS "copyVersionId"
      FROM "_RowToTable" rt JOIN "Row" r ON r."versionId" = rt."A"
      WHERE rt."B" = ${versionId} AND NOT r."readonly"
    ), copied AS (
      INSERT INTO "Row" ("versionId", "createdId", "id", "readonly", "data", "meta", "hash",
                         "schemaHash", "createdAt", "updatedAt", "publishedAt")
      SELECT "copyVersionId", "createdId", "id", false, "data", "meta", "hash", "schemaHash",
             "createdAt", "updatedAt", "publishedAt"
      FROM source
      RETURNING "versionId"
    ), linked AS (
      INSERT INTO "_RowToTable" ("A", "B") SELECT "versionId", ${copyId} FROM copied
    )
    INSERT INTO "_FileBlobToRow" ("A", "B")
    SELECT fbr."A", s."copyVersionId"
    FROM source s JOIN "_FileBlobToRow" fbr ON fbr."B" = s."versionId"
  `;
  await tx.$executeRaw`
    INSERT INTO "_RowToTable" ("A", "B")
    SELECT rt."A", ${copyId} FROM "_RowToTable" rt JOIN "Row" r ON r."versionId" = rt."A"
    WHERE rt."B" = ${versionId} AND r."readonly"
  `;
}

export async function analyze(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'ANALYZE "Row", "_RowToTable", "Table", "_RevisionToTable", "Revision"',
  );
}

export async function sweepOrphans(
  prisma: PrismaService,
): Promise<{ tables: number; rows: number }> {
  const tables = await prisma.$executeRaw`
    DELETE FROM "Table" t
    WHERE NOT EXISTS (SELECT 1 FROM "_RevisionToTable" rt WHERE rt."B" = t."versionId")
  `;
  const rows = await prisma.$executeRaw`
    DELETE FROM "Row" r
    WHERE NOT EXISTS (SELECT 1 FROM "_RowToTable" rt WHERE rt."A" = r."versionId")
  `;
  return { tables, rows };
}

export async function vacuum(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'VACUUM ANALYZE "Row", "_RowToTable", "Table"',
  );
}

export async function vacuumFull(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'VACUUM FULL ANALYZE "Row", "_RowToTable", "Table", "_RevisionToTable", "Revision", "Branch", "TableMigration", "FileBlob", "_FileBlobToRow", "ProjectFileUsage"',
  );
}

export function exactProject(projectId: string): string {
  return projectId.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export function runProjectId(datasetName: string, label: string): string {
  return `${BENCH_PROJECT_PREFIX}run-${datasetName}-${label}-${nanoid(SUFFIX_LENGTH)}`;
}
