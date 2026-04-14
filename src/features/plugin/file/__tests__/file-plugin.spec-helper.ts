import { nanoid } from 'nanoid';
import {
  createEmptyFile,
  prepareBranch,
  prepareRow,
  prepareTableWithSchema,
} from 'src/__tests__/utils/prepareProject';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { createTestingModule } from 'src/features/draft/commands/handlers/__tests__/utils';
import { FileStatus } from 'src/features/plugin/file/consts';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import {
  getArraySchema,
  getObjectSchema,
  getRefSchema,
} from '@revisium/schema-toolkit/mocks';
import type { PrismaService } from 'src/infrastructure/database/prisma.service';

export interface FilePluginScenario {
  draftRevisionId: string;
  table: Awaited<ReturnType<typeof prepareTableWithSchema>>;
  schemaStore: ReturnType<JsonSchemaStoreService['create']>;
}

export async function createFilePluginTestKit(): Promise<DraftTestKit> {
  return createTestingModule();
}

export async function givenFilePluginScenario(
  prismaService: PrismaService,
  jsonSchemaStore: JsonSchemaStoreService,
): Promise<FilePluginScenario> {
  const branch = await prepareBranch(prismaService);
  const schema = getObjectSchema({
    file: getRefSchema(SystemSchemaIds.File),
    files: getArraySchema(getRefSchema(SystemSchemaIds.File)),
  });

  const table = await prepareTableWithSchema({
    prismaService,
    headRevisionId: branch.headRevisionId,
    draftRevisionId: branch.draftRevisionId,
    schemaTableVersionId: branch.schemaTableVersionId,
    migrationTableVersionId: branch.migrationTableVersionId,
    schema,
  });

  return {
    draftRevisionId: branch.draftRevisionId,
    table,
    schemaStore: jsonSchemaStore.create(schema),
  };
}

export async function givenFilePluginRow({
  prismaService,
  scenario,
  data,
  draftData = data,
}: {
  prismaService: PrismaService;
  scenario: FilePluginScenario;
  data: Record<string, unknown>;
  draftData?: Record<string, unknown>;
}) {
  return prepareRow({
    prismaService,
    headTableVersionId: scenario.table.headTableVersionId,
    draftTableVersionId: scenario.table.draftTableVersionId,
    schema: scenario.table.schema,
    data,
    dataDraft: draftData,
  });
}

export function createPreviousFile() {
  const file = createEmptyFile();
  file.status = FileStatus.ready;
  file.fileId = nanoid();
  return file;
}
