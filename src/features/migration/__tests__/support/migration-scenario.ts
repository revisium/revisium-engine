import { JsonSchemaTypeName } from '@revisium/schema-toolkit/types';
import type { MigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';
import { prepareBranch } from 'src/__tests__/utils/prepareProject';

const TABLE_ID = 'products';
const ROW_ID_DIGITS = 3;

const productSchema = {
  type: JsonSchemaTypeName.Object,
  required: ['ver'],
  properties: {
    ver: { type: JsonSchemaTypeName.Number, default: 0 },
  },
  additionalProperties: false,
};

export interface DraftOwnedTable {
  projectId: string;
  branchName: string;
  revisionId: string;
  tableId: string;
  rowIds: string[];
}

export interface StartedMigration extends DraftOwnedTable {
  migrationId: string;
  field: string;
}

export async function givenStartedFieldAddition(
  kit: MigrationTestKit,
  { rowCount, field }: { rowCount: number; field: string },
): Promise<StartedMigration> {
  const table = await givenDraftOwnedTable(kit, rowCount);

  const { migrationId } = await kit.draftApi.apiUpdateTable({
    revisionId: table.revisionId,
    tableId: table.tableId,
    patches: [
      {
        op: 'add',
        path: `/properties/${field}`,
        value: { type: JsonSchemaTypeName.Number, default: 0 },
      },
    ],
  });

  if (!migrationId) {
    throw new Error('The field addition did not start an async migration');
  }

  return { ...table, migrationId, field };
}

async function givenDraftOwnedTable(
  kit: MigrationTestKit,
  rowCount: number,
): Promise<DraftOwnedTable> {
  const branch = await prepareBranch(kit.prisma);
  const rowIds = Array.from(
    { length: rowCount },
    (_, index) => `row-${String(index).padStart(ROW_ID_DIGITS, '0')}`,
  );

  await kit.draftApi.apiCreateTable({
    revisionId: branch.draftRevisionId,
    tableId: TABLE_ID,
    schema: productSchema,
  });
  await kit.draftApi.apiCreateRows({
    revisionId: branch.draftRevisionId,
    tableId: TABLE_ID,
    rows: rowIds.map((rowId, index) => ({ rowId, data: { ver: index } })),
  });

  return {
    projectId: branch.projectId,
    branchName: branch.branchName,
    revisionId: branch.draftRevisionId,
    tableId: TABLE_ID,
    rowIds,
  };
}
