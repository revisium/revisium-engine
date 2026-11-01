import { SchemaTable } from '@revisium/schema-toolkit/lib';
import {
  JsonSchemaTypeName,
  type JsonObjectSchema,
  type InitMigration,
  type JsonPatch,
  type Migration,
  type UpdateMigration,
} from '@revisium/schema-toolkit/types';
import objectHash from 'object-hash';
import { observeCommittedVersions } from 'src/__tests__/assertions/migration';
import type { MigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';
import type { InputJsonValue } from 'src/engine-prisma-types';
import {
  prepareBranch,
  type BranchGraph,
} from 'src/__tests__/utils/prepareProject';
import type { ApplyMigrationResult } from 'src/features/draft/commands/impl/migration';
import { MigrationContextService } from 'src/features/draft/migration-context.service';
import { ViewsApiService } from 'src/features/views/views-api.service';
import type { TableViewsData } from 'src/features/views/types';

const TABLE_ID = 'products';
const ROW_ID_DIGITS = 3;

const productSchema: JsonObjectSchema = {
  type: JsonSchemaTypeName.Object,
  required: ['ver'],
  properties: {
    ver: { type: JsonSchemaTypeName.Number, default: 0 },
  },
  additionalProperties: false,
};

export const productViews: TableViewsData = {
  version: 1,
  defaultViewId: 'main',
  views: [
    {
      id: 'main',
      name: 'Main',
      columns: [{ field: 'data.ver', width: 100 }],
      sorts: [{ field: 'data.ver', direction: 'asc' }],
    },
  ],
};

export interface DraftOwnedTable {
  projectId: string;
  branchId: string;
  branchName: string;
  revisionId: string;
  tableId: string;
  rowIds: string[];
}

export interface CommittedTable extends DraftOwnedTable {
  headRevisionId: string;
}

export interface CommittedRevisions {
  headRevisionId: string;
  draftRevisionId: string;
}

export interface DraftWithTables {
  revisionId: string;
  tables: DraftOwnedTable[];
}

export interface TableContents {
  schema: JsonObjectSchema;
  rows: InputJsonValue[];
  views?: TableViewsData;
}

export interface StartedMigration extends DraftOwnedTable {
  migrationId: string;
  field: string;
  patches: JsonPatch[];
}

export interface ImportedUpdate {
  migrationId: string;
  patches: JsonPatch[];
}

export async function givenStartedFieldAddition(
  kit: MigrationTestKit,
  { rowCount, field }: { rowCount: number; field: string },
): Promise<StartedMigration> {
  const table = await givenDraftOwnedTable(kit, rowCount);

  return startFieldAddition(kit, table, field);
}

export async function givenStartedFieldRemoval(
  kit: MigrationTestKit,
  { rowCount, field }: { rowCount: number; field: string },
): Promise<StartedMigration> {
  const table = await givenDraftOwnedTable(
    kit,
    rowCount,
    productSchemaWith(field),
  );

  return startFieldRemoval(kit, table, field);
}

export async function givenCommittedTable(
  kit: MigrationTestKit,
  { rowCount, views }: { rowCount: number; views?: TableViewsData },
): Promise<CommittedTable> {
  const table = await givenDraftOwnedTableWith(kit, {
    schema: productSchema,
    rows: rowsOf(productSchema, rowCount),
    views,
  });
  const { headRevisionId, draftRevisionId } = await commitDraft(kit, table);

  return { ...table, headRevisionId, revisionId: draftRevisionId };
}

export function startFieldAddition(
  kit: MigrationTestKit,
  table: DraftOwnedTable,
  field: string,
): Promise<StartedMigration> {
  return startAsyncUpdate(kit, table, field, fieldAdditionOf(field));
}

export function startImportedFieldAddition(
  kit: MigrationTestKit,
  table: DraftOwnedTable,
  { field, migrationId }: { field: string; migrationId: string },
): Promise<StartedMigration> {
  return kit.module
    .get(MigrationContextService)
    .run(migrationId, () => startFieldAddition(kit, table, field));
}

export function importFieldAddition(
  kit: MigrationTestKit,
  table: DraftOwnedTable,
  { field, migrationId }: { field: string; migrationId: string },
): Promise<ApplyMigrationResult[]> {
  return importMigrations(
    kit,
    table,
    importedUpdatesOf(table, [
      { migrationId, patches: fieldAdditionOf(field) },
    ]),
  );
}

export function importMigrations(
  kit: MigrationTestKit,
  table: Pick<DraftOwnedTable, 'revisionId'>,
  migrations: Migration[],
): Promise<ApplyMigrationResult[]> {
  return kit.draftApi.applyMigrations({
    revisionId: table.revisionId,
    migrations,
  });
}

export function importedTableCreationOf(
  tableId: string,
  migrationId: string,
): InitMigration {
  return {
    changeType: 'init',
    id: migrationId,
    tableId,
    hash: objectHash(productSchema),
    schema: productSchema,
  };
}

export function importedUpdatesOf(
  table: Pick<DraftOwnedTable, 'tableId'>,
  updates: ImportedUpdate[],
  schema: JsonObjectSchema = productSchema,
): UpdateMigration[] {
  const target = new SchemaTable(schema);

  return updates.map(({ migrationId, patches }) => {
    target.applyPatches(patches);

    return {
      changeType: 'update',
      id: migrationId,
      tableId: table.tableId,
      hash: objectHash(target.getSchema()),
      patches,
    };
  });
}

export function startFieldRemoval(
  kit: MigrationTestKit,
  table: DraftOwnedTable,
  field: string,
): Promise<StartedMigration> {
  return startAsyncUpdate(kit, table, field, [
    { op: 'remove', path: `/properties/${field}` },
  ]);
}

export function startFieldRename(
  kit: MigrationTestKit,
  table: DraftOwnedTable,
  { from, to }: { from: string; to: string },
): Promise<StartedMigration> {
  return startAsyncUpdate(kit, table, to, fieldRenameOf({ from, to }));
}

export async function commitDraft(
  kit: MigrationTestKit,
  branch: Pick<DraftOwnedTable, 'projectId' | 'branchId' | 'branchName'>,
): Promise<CommittedRevisions> {
  await kit.draftApi.apiCreateRevision({
    projectId: branch.projectId,
    branchName: branch.branchName,
  });
  await observeCommittedVersions(kit, branch.branchId);

  return {
    headRevisionId: await findRevisionId(kit, branch.branchId, 'isHead'),
    draftRevisionId: await findRevisionId(kit, branch.branchId, 'isDraft'),
  };
}

export async function findRevisionId(
  kit: MigrationTestKit,
  branchId: string,
  role: 'isHead' | 'isDraft',
): Promise<string> {
  const revision = await kit.prisma.revision.findFirstOrThrow({
    where: { branchId, [role]: true },
  });

  return revision.id;
}

export async function startAsyncUpdate(
  kit: MigrationTestKit,
  table: DraftOwnedTable,
  field: string,
  patches: JsonPatch[],
): Promise<StartedMigration> {
  const { migrationId } = await kit.draftApi.apiUpdateTable({
    revisionId: table.revisionId,
    tableId: table.tableId,
    patches,
  });

  if (!migrationId) {
    throw new Error('The table update did not start an async migration');
  }

  return { ...table, migrationId, field, patches };
}

export function givenDraftOwnedTable(
  kit: MigrationTestKit,
  rowCount: number,
  schema: JsonObjectSchema = productSchema,
): Promise<DraftOwnedTable> {
  return givenDraftOwnedTableWith(kit, {
    schema,
    rows: rowsOf(schema, rowCount),
  });
}

export async function givenDraftOwnedTableWith(
  kit: MigrationTestKit,
  contents: TableContents,
): Promise<DraftOwnedTable> {
  const branch = await prepareBranch(kit.prisma);
  const table = await addDraftOwnedTable(kit, branch, {
    tableId: TABLE_ID,
    ...contents,
  });
  await observeCommittedVersions(kit, branch.branchId);

  return table;
}

export async function givenDraftOwnedTables(
  kit: MigrationTestKit,
  { tableIds, rowCount }: { tableIds: string[]; rowCount: number },
): Promise<DraftWithTables> {
  const branch = await prepareBranch(kit.prisma);
  const tables: DraftOwnedTable[] = [];

  for (const tableId of tableIds) {
    tables.push(
      await addDraftOwnedTable(kit, branch, {
        tableId,
        schema: productSchema,
        rows: rowsOf(productSchema, rowCount),
      }),
    );
  }
  await observeCommittedVersions(kit, branch.branchId);

  return { revisionId: branch.draftRevisionId, tables };
}

async function addDraftOwnedTable(
  kit: MigrationTestKit,
  branch: BranchGraph,
  { tableId, schema, rows, views }: TableContents & { tableId: string },
): Promise<DraftOwnedTable> {
  const rowIds = rows.map((_, index) => rowIdOf(index));

  await kit.draftApi.apiCreateTable({
    revisionId: branch.draftRevisionId,
    tableId,
    schema,
  });
  await kit.draftApi.apiCreateRows({
    revisionId: branch.draftRevisionId,
    tableId,
    rows: rows.map((data, index) => ({ rowId: rowIdOf(index), data })),
    // Restored rows may carry files that are already uploaded.
    isRestore: true,
  });

  if (views) {
    await kit.module.get(ViewsApiService).updateTableViews({
      revisionId: branch.draftRevisionId,
      tableId,
      viewsData: views,
    });
  }

  return {
    projectId: branch.projectId,
    branchId: branch.branchId,
    branchName: branch.branchName,
    revisionId: branch.draftRevisionId,
    tableId,
    rowIds,
  };
}

export function fieldAdditionOf(field: string): JsonPatch[] {
  return [
    {
      op: 'add',
      path: `/properties/${field}`,
      value: { type: JsonSchemaTypeName.Number, default: 0 },
    },
  ];
}

export function fieldRenameOf({
  from,
  to,
}: {
  from: string;
  to: string;
}): JsonPatch[] {
  return [
    { op: 'move', from: `/properties/${from}`, path: `/properties/${to}` },
  ];
}

function productSchemaWith(field: string): JsonObjectSchema {
  return {
    ...productSchema,
    required: ['ver', field],
    properties: {
      ...productSchema.properties,
      [field]: { type: JsonSchemaTypeName.Number, default: 0 },
    },
  };
}

function rowIdOf(index: number): string {
  return `row-${String(index).padStart(ROW_ID_DIGITS, '0')}`;
}

function rowsOf(schema: JsonObjectSchema, rowCount: number): InputJsonValue[] {
  return Array.from({ length: rowCount }, (_, index) =>
    Object.fromEntries(
      Object.keys(schema.properties).map((field) => [field, index]),
    ),
  );
}
