import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { PrismaService } from 'src/infrastructure/database/prisma.service';
import {
  prepareBranch,
  prepareRow,
  prepareTableWithSchema,
} from 'src/__tests__/utils/prepareProject';

interface MigrationRowInput {
  id?: string;
  data: Record<string, unknown>;
  draftData?: Record<string, unknown>;
}

interface GivenMigrationTableWithRowsOptions {
  prisma: PrismaService;
  schema: JsonSchema;
  rows?: MigrationRowInput[] | ((index: number) => Record<string, unknown>);
  rowCount?: number;
}

export async function givenMigrationTableWithRows({
  prisma,
  schema,
  rows,
  rowCount,
}: GivenMigrationTableWithRowsOptions) {
  const branchData = await prepareBranch(prisma);
  const tableResult = await prepareTableWithSchema({
    prismaService: prisma,
    headRevisionId: branchData.headRevisionId,
    draftRevisionId: branchData.draftRevisionId,
    schemaTableVersionId: branchData.schemaTableVersionId,
    migrationTableVersionId: branchData.migrationTableVersionId,
    schema,
  });

  const normalizedRows = normalizeRows(rows, rowCount ?? 0);
  const rowIds: string[] = [];

  for (const row of normalizedRows) {
    const createdRow = await prepareRow({
      prismaService: prisma,
      headTableVersionId: tableResult.headTableVersionId,
      draftTableVersionId: tableResult.draftTableVersionId,
      rowId: row.id,
      data: row.data,
      dataDraft: row.draftData ?? row.data,
      schema,
    });

    rowIds.push(row.id ?? createdRow.rowId);
  }

  return {
    ...branchData,
    ...tableResult,
    rowIds,
  };
}

function normalizeRows(
  rows: GivenMigrationTableWithRowsOptions['rows'],
  rowCount: number,
): MigrationRowInput[] {
  if (Array.isArray(rows)) {
    return rows;
  }

  if (typeof rows === 'function') {
    return Array.from({ length: rowCount }, (_, index) => ({
      data: rows(index),
    }));
  }

  return Array.from({ length: rowCount }, (_, index) => ({
    data: { ver: index },
  }));
}
