import { nanoid } from 'nanoid';
import hash from 'object-hash';
import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import { FileStatus } from 'src/features/plugin/file/consts';
import { metaSchema } from 'src/features/share/schema/meta-schema';
import { tableMigrationsSchema } from 'src/features/share/schema/table-migrations-schema';
import { SystemTables } from 'src/features/share/system-tables.consts';
import {
  JsonPatchAdd,
  InitMigration,
  JsonSchema,
  JsonSchemaTypeName,
  JsonObjectSchema,
} from '@revisium/schema-toolkit/types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';

export type PrepareProjectReturnType = Awaited<
  ReturnType<typeof prepareProject>
>;

export async function prepareBranch(prismaService: PrismaService) {
  const projectId = `project-${nanoid()}`;
  const branchId = `branch-${nanoid()}`;
  const branchName = `name-${branchId}`;
  const headRevisionId = nanoid();
  const draftRevisionId = nanoid();

  await prismaService.branch.create({
    data: {
      id: branchId,
      name: branchName,
      isRoot: true,
      projectId,
      revisions: {
        createMany: {
          data: [
            {
              id: headRevisionId,
              isStart: true,
              isHead: true,
              hasChanges: false,
            },
            {
              id: draftRevisionId,
              parentId: headRevisionId,
              hasChanges: true,
              isDraft: true,
            },
          ],
        },
      },
    },
  });

  // schema table
  const schemaTableVersionId = nanoid();
  const schemaTableCreatedId = nanoid();

  await prismaService.table.create({
    data: {
      id: SystemTables.Schema,
      versionId: schemaTableVersionId,
      createdId: schemaTableCreatedId,
      readonly: true,
      system: true,
      revisions: {
        connect: [{ id: headRevisionId }, { id: draftRevisionId }],
      },
    },
  });

  // migration table
  const migrationTableVersionId = nanoid();
  const migrationTableCreatedId = nanoid();

  await prismaService.table.create({
    data: {
      id: SystemTables.Migration,
      versionId: migrationTableVersionId,
      createdId: migrationTableCreatedId,
      readonly: true,
      system: true,
      revisions: {
        connect: [{ id: headRevisionId }, { id: draftRevisionId }],
      },
    },
  });

  return {
    projectId,
    branchId,
    branchName,
    headRevisionId,
    draftRevisionId,
    schemaTableVersionId,
    schemaTableCreatedId,
    migrationTableVersionId,
    migrationTableCreatedId,
  };
}

export async function prepareTableWithSchema({
  prismaService,
  headRevisionId,
  draftRevisionId,
  schemaTableVersionId,
  migrationTableVersionId,
  schema,
}: {
  prismaService: PrismaService;
  headRevisionId: string;
  draftRevisionId: string;
  schemaTableVersionId: string;
  migrationTableVersionId: string;
  schema: JsonSchema;
}) {
  const schemaRowVersionId = nanoid();
  const migrationRowVersionId = nanoid();
  const tableId = `table-${nanoid()}`;
  const createdIdForTableInSchemaTable = `table-${nanoid()}`;
  const tableCreatedId = nanoid();
  const headTableVersionId = nanoid();
  const draftTableVersionId = nanoid();

  await prismaService.table.create({
    data: {
      id: tableId,
      createdId: tableCreatedId,
      versionId: headTableVersionId,
      readonly: true,
      revisions: {
        connect: { id: headRevisionId },
      },
    },
  });
  await prismaService.table.create({
    data: {
      id: tableId,
      createdId: tableCreatedId,
      versionId: draftTableVersionId,
      readonly: false,
      revisions: {
        connect: { id: draftRevisionId },
      },
    },
  });

  await prismaService.row.create({
    data: {
      id: tableId,
      versionId: schemaRowVersionId,
      createdId: createdIdForTableInSchemaTable,
      readonly: true,
      tables: {
        connect: {
          versionId: schemaTableVersionId,
        },
      },
      data: schema,
      meta: [
        {
          patches: [
            {
              op: 'add',
              path: '',
              value: schema,
            } as JsonPatchAdd,
          ],
          hash: hash(schema),
          date: new Date(),
        },
      ],
      hash: hash(schema),
      schemaHash: hash(metaSchema),
    },
  });

  const migration: InitMigration = {
    changeType: 'init',
    id: '2025-01-01T00:00:00Z',
    tableId,
    hash: hash(schema),
    schema,
  };

  await prismaService.row.create({
    data: {
      id: migration.id,
      versionId: migrationRowVersionId,
      createdId: nanoid(),
      readonly: true,
      tables: {
        connect: {
          versionId: migrationTableVersionId,
        },
      },
      data: migration,
      hash: hash(migration),
      schemaHash: hash(tableMigrationsSchema),
      publishedAt: migration.id,
    },
  });

  return {
    schemaRowVersionId,
    tableId,
    createdIdForTableInSchemaTable,
    tableCreatedId,
    headTableVersionId,
    draftTableVersionId,
    schema,
  };
}

export async function prepareRow({
  prismaService,
  headTableVersionId,
  draftTableVersionId,
  data,
  dataDraft,
  schema,
}: {
  prismaService: PrismaService;
  headTableVersionId: string;
  draftTableVersionId: string;
  data: object;
  dataDraft: object;
  schema: JsonSchema;
}) {
  const rowId = `row-${nanoid()}`;
  const rowCreatedId = nanoid();
  const headRowVersionId = nanoid();
  const draftRowVersionId = nanoid();

  const now = new Date();
  const row = await prismaService.row.create({
    data: {
      createdAt: now,
      updatedAt: now,
      publishedAt: now,
      id: rowId,
      versionId: headRowVersionId,
      createdId: rowCreatedId,
      readonly: true,
      tables: {
        connect: {
          versionId: headTableVersionId,
        },
      },
      data,
      hash: hash(data),
      schemaHash: hash(schema),
    },
  });
  const rowDraft = await prismaService.row.create({
    data: {
      createdAt: row.createdAt,
      updatedAt: new Date(),
      publishedAt: row.publishedAt,
      id: rowId,
      versionId: draftRowVersionId,
      createdId: rowCreatedId,
      readonly: false,
      tables: {
        connect: {
          versionId: draftTableVersionId,
        },
      },
      data: dataDraft,
      hash: hash(dataDraft),
      schemaHash: hash(schema),
    },
  });

  return {
    row,
    rowDraft,
    rowId,
    rowCreatedId,
    headRowVersionId,
    draftRowVersionId,
  };
}

export const prepareProject = async (prismaService: PrismaService) => {
  const testSchema: JsonObjectSchema = {
    type: JsonSchemaTypeName.Object,
    required: ['ver'],
    properties: {
      ver: {
        type: JsonSchemaTypeName.Number,
        default: 0,
      },
    },
    additionalProperties: false,
  };

  const prepareBranchResult = await prepareBranch(prismaService);
  const {
    headRevisionId,
    draftRevisionId,
    schemaTableVersionId,
    migrationTableVersionId,
  } = prepareBranchResult;
  const resultPrepareTableWithSchema = await prepareTableWithSchema({
    prismaService,
    headRevisionId,
    draftRevisionId,
    schemaTableVersionId,
    migrationTableVersionId,
    schema: testSchema,
  });
  const { headTableVersionId, draftTableVersionId } =
    resultPrepareTableWithSchema;
  const resultPrepareRow = await prepareRow({
    prismaService,
    headTableVersionId,
    draftTableVersionId,
    data: { ver: 1 },
    dataDraft: { ver: 2 },
    schema: testSchema,
  });

  return {
    ...prepareBranchResult,
    ...resultPrepareTableWithSchema,
    ...resultPrepareRow,
  };
};

export const createEmptyFile = () => ({
  status: '',
  fileId: '',
  url: '',
  fileName: '',
  hash: '',
  extension: '',
  mimeType: '',
  size: 0,
  width: 0,
  height: 0,
});

export const createPreviousFile = () => {
  const file = createEmptyFile();
  file.status = FileStatus.ready;
  file.fileId = nanoid();
  return file;
};

export async function prepareTableAndRowWithFile(
  prismaService: PrismaService,
  data: Record<string, unknown>,
) {
  const fileTableSchema: JsonObjectSchema = {
    type: JsonSchemaTypeName.Object,
    properties: {
      file: { $ref: SystemSchemaIds.File } as unknown as JsonObjectSchema,
      files: {
        type: JsonSchemaTypeName.Array,
        items: {
          $ref: SystemSchemaIds.File,
        },
      } as unknown as JsonObjectSchema,
    },
    required: ['file', 'files'],
    additionalProperties: false,
  };

  const branchResult = await prepareBranch(prismaService);

  const tableResult = await prepareTableWithSchema({
    prismaService,
    headRevisionId: branchResult.headRevisionId,
    draftRevisionId: branchResult.draftRevisionId,
    schemaTableVersionId: branchResult.schemaTableVersionId,
    migrationTableVersionId: branchResult.migrationTableVersionId,
    schema: fileTableSchema,
  });

  const rowResult = await prepareRow({
    prismaService,
    headTableVersionId: tableResult.headTableVersionId,
    draftTableVersionId: tableResult.draftTableVersionId,
    data,
    dataDraft: data,
    schema: fileTableSchema,
  });

  return {
    draftRevisionId: branchResult.draftRevisionId,
    headRevisionId: branchResult.headRevisionId,
    table: {
      tableId: tableResult.tableId,
      headTableVersionId: tableResult.headTableVersionId,
      draftTableVersionId: tableResult.draftTableVersionId,
    },
    row: rowResult.row,
    rowDraft: rowResult.rowDraft,
  };
}
