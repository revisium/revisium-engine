import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import {
  getNumberSchema,
  getObjectSchema,
  getRefSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import {
  givenDraftProjectWithSchema,
  type DraftProjectScenario,
} from 'src/__tests__/fixtures/scenarios/given-draft-project';
import { createExpressImageFile } from 'src/__tests__/utils/file';
import {
  createEmptyFile,
  createPreviousFile,
} from 'src/__tests__/utils/prepareProject';
import { ViewsApiService } from 'src/features/views/views-api.service';

export interface DraftWithFileRow extends DraftProjectScenario {
  file: ReturnType<typeof createPreviousFile>;
}

export interface DraftWriter {
  name: string;
  write(kit: DraftTestKit, draft: DraftWithFileRow): Promise<unknown>;
}

export const draftWriters: DraftWriter[] = [
  {
    name: 'createRow',
    write: (kit, draft) => createRow(kit, draft, 'created-row'),
  },
  {
    name: 'createRows',
    write: (kit, draft) =>
      kit.draftApiService.apiCreateRows({
        revisionId: draft.draftRevisionId,
        tableId: draft.tableId,
        rows: [
          { rowId: 'created-row', data: { ver: 2, file: createEmptyFile() } },
        ],
      }),
  },
  {
    name: 'updateRow',
    write: (kit, draft) =>
      kit.draftApiService.apiUpdateRow({
        revisionId: draft.draftRevisionId,
        tableId: draft.tableId,
        rowId: draft.rowId,
        data: { ver: 2, file: draft.file },
      }),
  },
  {
    name: 'updateRows',
    write: (kit, draft) =>
      kit.draftApiService.apiUpdateRows({
        revisionId: draft.draftRevisionId,
        tableId: draft.tableId,
        rows: [{ rowId: draft.rowId, data: { ver: 2, file: draft.file } }],
      }),
  },
  {
    name: 'patchRow',
    write: (kit, draft) =>
      kit.draftApiService.apiPatchRow({
        revisionId: draft.draftRevisionId,
        tableId: draft.tableId,
        rowId: draft.rowId,
        patches: [{ op: 'replace', path: 'ver', value: 2 }],
      }),
  },
  {
    name: 'patchRows',
    write: (kit, draft) =>
      kit.draftApiService.apiPatchRows({
        revisionId: draft.draftRevisionId,
        tableId: draft.tableId,
        rows: [
          {
            rowId: draft.rowId,
            patches: [{ op: 'replace', path: 'ver', value: 2 }],
          },
        ],
      }),
  },
  {
    name: 'renameRow',
    write: (kit, draft) =>
      kit.draftApiService.apiRenameRow({
        revisionId: draft.draftRevisionId,
        tableId: draft.tableId,
        rowId: draft.rowId,
        nextRowId: 'renamed-row',
      }),
  },
  {
    name: 'removeRow',
    write: (kit, draft) =>
      kit.draftApiService.apiRemoveRow({
        revisionId: draft.draftRevisionId,
        tableId: draft.tableId,
        rowId: draft.rowId,
      }),
  },
  {
    name: 'removeRows',
    write: (kit, draft) =>
      kit.draftApiService.apiRemoveRows({
        revisionId: draft.draftRevisionId,
        tableId: draft.tableId,
        rowIds: [draft.rowId],
      }),
  },
  {
    name: 'uploadFile',
    write: (kit, draft) =>
      kit.draftApiService.apiUploadFile({
        revisionId: draft.draftRevisionId,
        tableId: draft.tableId,
        rowId: draft.rowId,
        fileId: draft.file.fileId,
        file: createExpressImageFile(),
      }),
  },
  {
    name: 'createTable',
    write: (kit, draft) =>
      kit.draftApiService.apiCreateTable({
        revisionId: draft.draftRevisionId,
        tableId: 'created-table',
        schema: getObjectSchema({ name: getStringSchema() }),
      }),
  },
  {
    name: 'updateTable',
    write: (kit, draft) => updateTable(kit, draft),
  },
  {
    name: 'renameTable',
    write: (kit, draft) =>
      kit.draftApiService.apiRenameTable({
        revisionId: draft.draftRevisionId,
        tableId: draft.tableId,
        nextTableId: 'renamed-table',
      }),
  },
  {
    name: 'removeTable',
    write: (kit, draft) =>
      kit.draftApiService.apiRemoveTable({
        revisionId: draft.draftRevisionId,
        tableId: draft.tableId,
      }),
  },
  {
    name: 'updateTableViews',
    write: (kit, draft) =>
      kit.module.get(ViewsApiService).updateTableViews({
        revisionId: draft.draftRevisionId,
        tableId: draft.tableId,
        viewsData: {
          version: 1,
          defaultViewId: 'next',
          views: [{ id: 'next', name: 'Next' }],
        },
      }),
  },
  {
    name: 'createRevision',
    write: (kit, draft) =>
      kit.draftApiService.apiCreateRevision({
        projectId: draft.projectId,
        branchName: draft.branchName,
      }),
  },
];

const fileRowSchema = getObjectSchema({
  ver: getNumberSchema(),
  file: getRefSchema(SystemSchemaIds.File),
});

export async function givenDraftWithFileRow(
  kit: DraftTestKit,
): Promise<DraftWithFileRow> {
  const file = createPreviousFile();
  const draft = await givenDraftProjectWithSchema({
    prismaService: kit.prismaService,
    schema: fileRowSchema,
    row: { data: { ver: 1, file } },
  });

  return { ...draft, file };
}

export function createRow(
  kit: DraftTestKit,
  draft: DraftWithFileRow,
  rowId: string,
): Promise<unknown> {
  return kit.draftApiService.apiCreateRow({
    revisionId: draft.draftRevisionId,
    tableId: draft.tableId,
    rowId,
    data: { ver: 2, file: createEmptyFile() },
  });
}

export function updateTable(
  kit: DraftTestKit,
  draft: DraftWithFileRow,
): Promise<unknown> {
  return kit.draftApiService.apiUpdateTable({
    revisionId: draft.draftRevisionId,
    tableId: draft.tableId,
    patches: [
      { op: 'add', path: '/properties/name', value: getStringSchema() },
    ],
  });
}

export function readDraftContent(kit: DraftTestKit, revisionId: string) {
  return kit.prismaService.revision.findUniqueOrThrow({
    where: { id: revisionId },
    select: {
      isDraft: true,
      isHead: true,
      hasChanges: true,
      tables: {
        orderBy: { versionId: 'asc' },
        select: {
          id: true,
          versionId: true,
          rows: {
            orderBy: { versionId: 'asc' },
            select: { id: true, versionId: true, data: true },
          },
        },
      },
    },
  });
}

export async function readDraftRowIds(
  kit: DraftTestKit,
  draft: DraftWithFileRow,
): Promise<string[]> {
  const rows = await kit.prismaService.row.findMany({
    where: {
      tables: {
        some: {
          id: draft.tableId,
          revisions: { some: { id: draft.draftRevisionId } },
        },
      },
    },
    select: { id: true },
  });

  return rows.map((row) => row.id);
}

export function countDraftMigrations(
  kit: DraftTestKit,
  draft: DraftWithFileRow,
): Promise<number> {
  return kit.prismaService.tableMigration.count({
    where: { revisionId: draft.draftRevisionId },
  });
}
