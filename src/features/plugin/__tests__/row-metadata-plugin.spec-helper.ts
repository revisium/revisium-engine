import {
  prepareBranch,
  prepareRow,
  prepareTableWithSchema,
  type RowVersionPairResult,
  type TableWithSchemaResult,
} from 'src/__tests__/utils/prepareProject';
import { getObjectSchema, getRefSchema } from '@revisium/schema-toolkit/mocks';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { createTestingModule } from 'src/features/draft/commands/handlers/__tests__/utils';
import type { PrismaService } from 'src/infrastructure/database/prisma.service';
import type { JsonObjectSchema } from '@revisium/schema-toolkit/types';

export interface RowMetadataPluginScenario {
  draftRevisionId: string;
  table: TableWithSchemaResult;
  schema: JsonObjectSchema;
}

export interface GivenRowMetadataPluginTableOptions {
  prismaService: PrismaService;
  fieldName: string;
  schemaRef: string;
}

export interface GivenRowMetadataPluginRowOptions {
  prismaService: PrismaService;
  scenario: RowMetadataPluginScenario;
  data: Record<string, unknown>;
  draftData?: Record<string, unknown>;
}

export async function createRowMetadataPluginTestKit(): Promise<DraftTestKit> {
  return createTestingModule();
}

export async function givenRowMetadataPluginTable({
  prismaService,
  fieldName,
  schemaRef,
}: GivenRowMetadataPluginTableOptions): Promise<RowMetadataPluginScenario> {
  const branch = await prepareBranch(prismaService);
  const schema = getObjectSchema({
    [fieldName]: getRefSchema(schemaRef),
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
    schema,
  };
}

export async function givenRowMetadataPluginRow({
  prismaService,
  scenario,
  data,
  draftData = data,
}: GivenRowMetadataPluginRowOptions): Promise<RowVersionPairResult> {
  return prepareRow({
    prismaService,
    headTableVersionId: scenario.table.headTableVersionId,
    draftTableVersionId: scenario.table.draftTableVersionId,
    schema: scenario.schema,
    data,
    dataDraft: draftData,
  });
}
