import type { JsonSchema } from '@revisium/schema-toolkit/types';
import {
  prepareBranch,
  prepareRow,
  prepareTableWithSchema,
} from 'src/__tests__/utils/prepareProject';
import type { PrismaService } from 'src/infrastructure/database/prisma.service';

interface DraftRowInput {
  id?: string;
  data: Record<string, unknown>;
  draftData?: Record<string, unknown>;
}

interface GivenDraftWithRowsOptions {
  prisma: PrismaService;
  schema: JsonSchema;
  rows?: DraftRowInput[] | ((index: number) => Record<string, unknown>);
  rowCount?: number;
}

export interface DraftWithRowsScenario {
  draftRevisionId: string;
  headRevisionId: string;
  tableId: string;
  headTableVersionId: string;
  draftTableVersionId: string;
  rowIds: string[];
}

export async function givenDraftWithRows({
  prisma,
  schema,
  rows,
  rowCount,
}: GivenDraftWithRowsOptions): Promise<DraftWithRowsScenario> {
  const branch = await prepareBranch(prisma);
  const table = await prepareTableWithSchema({
    prismaService: prisma,
    headRevisionId: branch.headRevisionId,
    draftRevisionId: branch.draftRevisionId,
    schemaTableVersionId: branch.schemaTableVersionId,
    migrationTableVersionId: branch.migrationTableVersionId,
    schema,
  });

  const draftRows = normalizeRows(rows, rowCount ?? 0);
  const rowIds: string[] = [];

  for (const row of draftRows) {
    const createdRow = await prepareRow({
      prismaService: prisma,
      headTableVersionId: table.headTableVersionId,
      draftTableVersionId: table.draftTableVersionId,
      rowId: row.id,
      data: row.data,
      dataDraft: row.draftData ?? row.data,
      schema,
    });

    rowIds.push(row.id ?? createdRow.rowId);
  }

  return {
    draftRevisionId: branch.draftRevisionId,
    headRevisionId: branch.headRevisionId,
    tableId: table.tableId,
    headTableVersionId: table.headTableVersionId,
    draftTableVersionId: table.draftTableVersionId,
    rowIds,
  };
}

function normalizeRows(
  rows: GivenDraftWithRowsOptions['rows'],
  rowCount: number,
): DraftRowInput[] {
  if (Array.isArray(rows)) {
    return rows;
  }

  if (typeof rows === 'function') {
    return Array.from({ length: rowCount }, (_, index) => ({
      data: rows(index),
    }));
  }

  return [];
}
