import { prepareProject, prepareRow } from 'src/__tests__/utils/prepareProject';
import type { PrismaService } from 'src/infrastructure/database/prisma.service';
import type { JsonSchema } from '@revisium/schema-toolkit/types';

export interface DraftProjectScenario {
  projectId: string;
  branchId: string;
  branchName: string;
  headRevisionId: string;
  draftRevisionId: string;
  tableId: string;
  headTableVersionId: string;
  draftTableVersionId: string;
  rowId: string;
}

export interface DraftProjectWithRowsScenario extends DraftProjectScenario {
  extraRowIds: string[];
}

interface ExtraRowInput {
  rowId?: string;
  data: Record<string, unknown>;
  draftData?: Record<string, unknown>;
}

export async function givenDraftProject(
  prismaService: PrismaService,
): Promise<DraftProjectScenario> {
  const project = await prepareProject(prismaService);

  return {
    projectId: project.projectId,
    branchId: project.branchId,
    branchName: project.branchName,
    headRevisionId: project.headRevisionId,
    draftRevisionId: project.draftRevisionId,
    tableId: project.tableId,
    headTableVersionId: project.headTableVersionId,
    draftTableVersionId: project.draftTableVersionId,
    rowId: project.rowId,
  };
}

export async function givenDraftProjectWithRows({
  prismaService,
  schema,
  rows,
}: {
  prismaService: PrismaService;
  schema: JsonSchema;
  rows: ExtraRowInput[];
}): Promise<DraftProjectWithRowsScenario> {
  const draft = await givenDraftProject(prismaService);
  const extraRowIds: string[] = [];

  for (const row of rows) {
    const createdRow = await prepareRow({
      prismaService,
      headTableVersionId: draft.headTableVersionId,
      draftTableVersionId: draft.draftTableVersionId,
      rowId: row.rowId,
      data: row.data,
      dataDraft: row.draftData ?? row.data,
      schema,
    });

    extraRowIds.push(createdRow.rowId);
  }

  return {
    ...draft,
    extraRowIds,
  };
}

export async function givenReadonlyDraftTable({
  prismaService,
  draftTableVersionId,
}: {
  prismaService: PrismaService;
  draftTableVersionId: string;
}): Promise<void> {
  await prismaService.table.update({
    where: {
      versionId: draftTableVersionId,
    },
    data: {
      readonly: true,
    },
  });
}
