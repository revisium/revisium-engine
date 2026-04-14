import { nanoid } from 'nanoid';
import hash from 'object-hash';
import { Prisma } from 'src/__generated__/client';
import {
  createPreviousFile,
  prepareBranch,
  prepareRow,
  prepareTableAndRowWithFile,
  prepareTableWithSchema,
  type TableWithSchemaResult,
} from 'src/__tests__/utils/prepareProject';
import type { QueryTestKit } from 'src/__tests__/kit/create-query-test-kit';
import {
  getObjectSchema,
  getRefSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import { FileStatus } from 'src/features/plugin/file/consts';
import { metaSchema } from 'src/features/share/schema/meta-schema';
import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import type { JsonObjectSchema } from '@revisium/schema-toolkit/types';

function toInputJsonValue(
  data: Record<string, unknown>,
): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue;
}

export interface SearchRowsScenario {
  draftRevisionId: string;
  headRevisionId: string;
  tableId: string;
  schemaTableVersionId: string;
  migrationTableVersionId: string;
  draftTableVersionId: string;
  draftRowVersionId: string;
  headRowVersionId: string;
  schemaRowVersionId: string;
}

export interface ForeignKeysByScenario {
  draftRevisionId: string;
  table: TableWithSchemaResult;
  byTable: TableWithSchemaResult;
  rowId: string;
}

export interface ForeignKeysToScenario {
  draftRevisionId: string;
  table: TableWithSchemaResult;
  toTable: TableWithSchemaResult;
  rowId: string;
}

export interface RowByIdScenario {
  draftRevisionId: string;
  table: Awaited<ReturnType<typeof prepareTableAndRowWithFile>>['table'];
  rowDraft: Awaited<ReturnType<typeof prepareTableAndRowWithFile>>['rowDraft'];
}

export async function givenSearchRowsProject(
  kit: QueryTestKit,
): Promise<SearchRowsScenario> {
  const branch = await prepareBranch(kit.prismaService);
  const schema = getObjectSchema({
    ver: getStringSchema(),
  });
  const table = await prepareTableWithSchema({
    prismaService: kit.prismaService,
    headRevisionId: branch.headRevisionId,
    draftRevisionId: branch.draftRevisionId,
    schemaTableVersionId: branch.schemaTableVersionId,
    migrationTableVersionId: branch.migrationTableVersionId,
    schema,
  });
  const row = await prepareRow({
    prismaService: kit.prismaService,
    headTableVersionId: table.headTableVersionId,
    draftTableVersionId: table.draftTableVersionId,
    schema,
    data: { ver: '1' },
    dataDraft: { ver: '2' },
  });

  return {
    draftRevisionId: branch.draftRevisionId,
    headRevisionId: branch.headRevisionId,
    tableId: table.tableId,
    schemaTableVersionId: branch.schemaTableVersionId,
    migrationTableVersionId: branch.migrationTableVersionId,
    draftTableVersionId: table.draftTableVersionId,
    draftRowVersionId: row.draftRowVersionId,
    headRowVersionId: row.headRowVersionId,
    schemaRowVersionId: table.schemaRowVersionId,
  };
}

export async function updateSearchSchema({
  kit,
  schemaRowVersionId,
  schema,
}: {
  kit: QueryTestKit;
  schemaRowVersionId: string;
  schema: JsonObjectSchema;
}): Promise<void> {
  await kit.prismaService.row.update({
    where: { versionId: schemaRowVersionId },
    data: {
      data: schema,
      hash: hash(schema),
      schemaHash: hash(metaSchema),
    },
  });
}

export async function createSearchTable({
  kit,
  headRevisionId,
  draftRevisionId,
  schemaTableVersionId,
  migrationTableVersionId,
  schema,
}: {
  kit: QueryTestKit;
  headRevisionId: string;
  draftRevisionId: string;
  schemaTableVersionId: string;
  migrationTableVersionId: string;
  schema: JsonObjectSchema;
}) {
  return prepareTableWithSchema({
    prismaService: kit.prismaService,
    headRevisionId,
    draftRevisionId,
    schemaTableVersionId,
    migrationTableVersionId,
    schema,
  });
}

export async function createSearchRow({
  kit,
  tableVersionId,
  data,
}: {
  kit: QueryTestKit;
  tableVersionId: string;
  data: Record<string, unknown>;
}) {
  return kit.prismaService.row.create({
    data: {
      tables: { connect: { versionId: tableVersionId } },
      id: nanoid(),
      versionId: nanoid(),
      createdId: nanoid(),
      hash: '',
      schemaHash: '',
      data: toInputJsonValue(data),
    },
  });
}

export async function updateSearchRow({
  kit,
  rowVersionId,
  data,
  schema,
}: {
  kit: QueryTestKit;
  rowVersionId: string;
  data: Record<string, unknown>;
  schema: JsonObjectSchema;
}) {
  await kit.prismaService.row.update({
    where: { versionId: rowVersionId },
    data: {
      data: toInputJsonValue(data),
      hash: hash(data),
      schemaHash: hash(schema),
    },
  });
}

export async function givenForeignKeysByScenario(
  kit: QueryTestKit,
): Promise<ForeignKeysByScenario> {
  const {
    headRevisionId,
    draftRevisionId,
    schemaTableVersionId,
    migrationTableVersionId,
  } = await prepareBranch(kit.prismaService);

  const table = await prepareTableWithSchema({
    prismaService: kit.prismaService,
    headRevisionId,
    draftRevisionId,
    schemaTableVersionId,
    migrationTableVersionId,
    schema: getObjectSchema({
      title: getStringSchema(),
    }),
  });

  const byTable = await prepareTableWithSchema({
    prismaService: kit.prismaService,
    headRevisionId,
    draftRevisionId,
    schemaTableVersionId,
    migrationTableVersionId,
    schema: getObjectSchema({
      file: getRefSchema(SystemSchemaIds.File),
      link: getStringSchema({
        foreignKey: table.tableId,
      }),
    }),
  });

  const row = await prepareRow({
    prismaService: kit.prismaService,
    headTableVersionId: table.headTableVersionId,
    draftTableVersionId: table.draftTableVersionId,
    schema: table.schema,
    data: { title: 'title' },
    dataDraft: { title: 'title' },
  });

  const data = {
    file: {
      ...createPreviousFile(),
      status: FileStatus.uploaded,
      url: '',
    },
    link: row.rowId,
  };

  await prepareRow({
    prismaService: kit.prismaService,
    headTableVersionId: byTable.headTableVersionId,
    draftTableVersionId: byTable.draftTableVersionId,
    schema: byTable.schema,
    data,
    dataDraft: data,
  });

  return {
    draftRevisionId,
    table,
    byTable,
    rowId: row.rowId,
  };
}

export async function givenForeignKeysToScenario(
  kit: QueryTestKit,
): Promise<ForeignKeysToScenario> {
  const {
    headRevisionId,
    draftRevisionId,
    schemaTableVersionId,
    migrationTableVersionId,
  } = await prepareBranch(kit.prismaService);

  const toTable = await prepareTableWithSchema({
    prismaService: kit.prismaService,
    headRevisionId,
    draftRevisionId,
    schemaTableVersionId,
    migrationTableVersionId,
    schema: getObjectSchema({
      file: getRefSchema(SystemSchemaIds.File),
      title: getStringSchema(),
    }),
  });

  const table = await prepareTableWithSchema({
    prismaService: kit.prismaService,
    headRevisionId,
    draftRevisionId,
    schemaTableVersionId,
    migrationTableVersionId,
    schema: getObjectSchema({
      link: getStringSchema({
        foreignKey: toTable.tableId,
      }),
    }),
  });

  const toData = {
    file: {
      ...createPreviousFile(),
      status: FileStatus.uploaded,
      url: '',
    },
    title: 'title',
  };

  const toRow = await prepareRow({
    prismaService: kit.prismaService,
    headTableVersionId: toTable.headTableVersionId,
    draftTableVersionId: toTable.draftTableVersionId,
    schema: toTable.schema,
    data: toData,
    dataDraft: toData,
  });

  const data = { link: toRow.rowId };

  const row = await prepareRow({
    prismaService: kit.prismaService,
    headTableVersionId: table.headTableVersionId,
    draftTableVersionId: table.draftTableVersionId,
    schema: table.schema,
    data,
    dataDraft: data,
  });

  return {
    draftRevisionId,
    table,
    toTable,
    rowId: row.rowId,
  };
}

export async function givenRowByIdScenario(
  kit: QueryTestKit,
): Promise<RowByIdScenario> {
  const data = {
    file: {
      ...createPreviousFile(),
      status: FileStatus.uploaded,
      url: '',
    },
    files: [],
  };

  const { draftRevisionId, table, rowDraft } = await prepareTableAndRowWithFile(
    kit.prismaService,
    data,
  );

  return {
    draftRevisionId,
    table,
    rowDraft,
  };
}
