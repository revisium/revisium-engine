import hash from 'object-hash';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import {
  type BranchGraph,
  prepareBranch,
  prepareTableWithSchema,
} from 'src/__tests__/utils/prepareProject';
import {
  getTestLinkedSchema,
  testSchema,
} from 'src/features/draft/commands/handlers/__tests__/utils';
import { SystemTables } from 'src/features/share/system-tables.consts';

const ID_NUMBER_WIDTH = 3;

export interface ReferencedTable {
  branch: BranchGraph;
  draftRevisionId: string;
  tableId: string;
}

interface DraftRowsInput {
  tableVersionIds: string[];
  rowIds: string[];
  data: object;
  schema: JsonSchema;
}

export async function givenTableWithRows(
  kit: DraftTestKit,
  { tableId, rowIds }: { tableId: string; rowIds: string[] },
): Promise<ReferencedTable> {
  const branch = await prepareBranch(kit.prismaService);
  const draftTableVersionId = await createTable(
    kit,
    branch,
    tableId,
    testSchema,
  );

  await insertDraftRows(kit, {
    tableVersionIds: [draftTableVersionId],
    rowIds,
    data: { ver: 0 },
    schema: testSchema,
  });

  return { branch, draftRevisionId: branch.draftRevisionId, tableId };
}

export async function givenTableReferencingRow(
  kit: DraftTestKit,
  referenced: ReferencedTable,
  {
    tableId,
    rowCount,
    referencedRowId,
  }: { tableId: string; rowCount: number; referencedRowId: string },
): Promise<void> {
  const schema = getTestLinkedSchema(referenced.tableId);
  const draftTableVersionId = await createTable(
    kit,
    referenced.branch,
    tableId,
    schema,
  );

  await insertDraftRows(kit, {
    tableVersionIds: [draftTableVersionId],
    rowIds: numberedIds('row', rowCount),
    data: { link: referencedRowId },
    schema,
  });
}

export async function givenTablesReferencingRow(
  kit: DraftTestKit,
  referenced: ReferencedTable,
  {
    tableCount,
    referencedRowId,
  }: { tableCount: number; referencedRowId: string },
): Promise<void> {
  const schema = getTestLinkedSchema(referenced.tableId);
  const draftTableVersionIds: string[] = [];

  for (const tableId of numberedIds('referrer', tableCount)) {
    draftTableVersionIds.push(
      await createTable(kit, referenced.branch, tableId, schema),
    );
  }

  await insertDraftRows(kit, {
    tableVersionIds: draftTableVersionIds,
    rowIds: numberedIds('row', 1),
    data: { link: referencedRowId },
    schema,
  });
}

export function countDraftRowsReferencing(
  kit: DraftTestKit,
  referenced: ReferencedTable,
  rowId: string,
): Promise<number> {
  return kit.prismaService.row.count({
    where: {
      data: { path: ['link'], equals: rowId },
      tables: {
        some: { revisions: { some: { id: referenced.draftRevisionId } } },
      },
    },
  });
}

export function countDraftSchemasReferencing(
  kit: DraftTestKit,
  draftRevisionId: string,
  tableId: string,
): Promise<number> {
  return kit.prismaService.row.count({
    where: {
      data: { path: ['properties', 'link', 'foreignKey'], equals: tableId },
      tables: {
        some: {
          id: SystemTables.Schema,
          revisions: { some: { id: draftRevisionId } },
        },
      },
    },
  });
}

export function countDraftRows(
  kit: DraftTestKit,
  table: ReferencedTable,
): Promise<number> {
  return kit.prismaService.row.count({
    where: {
      tables: {
        some: {
          id: table.tableId,
          revisions: { some: { id: table.draftRevisionId } },
        },
      },
    },
  });
}

async function createTable(
  kit: DraftTestKit,
  branch: BranchGraph,
  tableId: string,
  schema: JsonSchema,
): Promise<string> {
  const table = await prepareTableWithSchema({
    prismaService: kit.prismaService,
    headRevisionId: branch.headRevisionId,
    draftRevisionId: branch.draftRevisionId,
    schemaTableVersionId: branch.schemaTableVersionId,
    migrationTableVersionId: branch.migrationTableVersionId,
    tableId,
    schema,
  });

  return table.draftTableVersionId;
}

async function insertDraftRows(
  kit: DraftTestKit,
  { tableVersionIds, rowIds, data, schema }: DraftRowsInput,
): Promise<void> {
  await kit.prismaService.$executeRaw`
    WITH draft_rows AS MATERIALIZED (
      SELECT gen_random_uuid()::text AS "versionId", "tableVersionId", "rowId"
      FROM unnest(${tableVersionIds}::text[]) AS "tableVersionId"
      CROSS JOIN unnest(${rowIds}::text[]) AS "rowId"
    ),
    inserted_rows AS (
      INSERT INTO "Row" ("versionId", "createdId", "id", "data", "hash", "schemaHash")
      SELECT "versionId", gen_random_uuid()::text, "rowId", ${JSON.stringify(data)}::jsonb, ${hash(data)}, ${hash(schema)}
      FROM draft_rows
    )
    INSERT INTO "_RowToTable" ("A", "B")
    SELECT "versionId", "tableVersionId"
    FROM draft_rows
  `;
}

function numberedIds(prefix: string, count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `${prefix}-${String(index).padStart(ID_NUMBER_WIDTH, '0')}`,
  );
}
