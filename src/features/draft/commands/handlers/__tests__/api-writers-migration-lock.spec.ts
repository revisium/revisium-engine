import {
  getObjectSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import {
  createDraftTestKit,
  type DraftTestKit,
} from 'src/__tests__/kit/create-draft-test-kit';
import { createExpressImageFile } from 'src/__tests__/utils/file';
import { createEmptyFile } from 'src/__tests__/utils/prepareProject';
import type { DraftApiService } from 'src/features/draft/draft-api.service';
import { MigrationLockedException } from 'src/features/migration/exceptions/migration-locked.exception';
import {
  givenDraftWithFileRow,
  readDraftContent,
  writeWhileMigrationStarts,
  type DraftWithFileRow,
} from './support/writer-migration-race';

interface DraftWriter {
  name: string;
  write(api: DraftApiService, draft: DraftWithFileRow): Promise<unknown>;
}

const writers: DraftWriter[] = [
  {
    name: 'createRow',
    write: (api, draft) =>
      api.apiCreateRow({
        revisionId: draft.draftRevisionId,
        tableId: draft.tableId,
        rowId: 'created-row',
        data: { ver: 2, file: createEmptyFile() },
      }),
  },
  {
    name: 'createRows',
    write: (api, draft) =>
      api.apiCreateRows({
        revisionId: draft.draftRevisionId,
        tableId: draft.tableId,
        rows: [
          { rowId: 'created-row', data: { ver: 2, file: createEmptyFile() } },
        ],
      }),
  },
  {
    name: 'updateRow',
    write: (api, draft) =>
      api.apiUpdateRow({
        revisionId: draft.draftRevisionId,
        tableId: draft.tableId,
        rowId: draft.rowId,
        data: { ver: 2, file: draft.file },
      }),
  },
  {
    name: 'updateRows',
    write: (api, draft) =>
      api.apiUpdateRows({
        revisionId: draft.draftRevisionId,
        tableId: draft.tableId,
        rows: [{ rowId: draft.rowId, data: { ver: 2, file: draft.file } }],
      }),
  },
  {
    name: 'patchRow',
    write: (api, draft) =>
      api.apiPatchRow({
        revisionId: draft.draftRevisionId,
        tableId: draft.tableId,
        rowId: draft.rowId,
        patches: [{ op: 'replace', path: 'ver', value: 2 }],
      }),
  },
  {
    name: 'patchRows',
    write: (api, draft) =>
      api.apiPatchRows({
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
    write: (api, draft) =>
      api.apiRenameRow({
        revisionId: draft.draftRevisionId,
        tableId: draft.tableId,
        rowId: draft.rowId,
        nextRowId: 'renamed-row',
      }),
  },
  {
    name: 'removeRow',
    write: (api, draft) =>
      api.apiRemoveRow({
        revisionId: draft.draftRevisionId,
        tableId: draft.tableId,
        rowId: draft.rowId,
      }),
  },
  {
    name: 'removeRows',
    write: (api, draft) =>
      api.apiRemoveRows({
        revisionId: draft.draftRevisionId,
        tableId: draft.tableId,
        rowIds: [draft.rowId],
      }),
  },
  {
    name: 'uploadFile',
    write: (api, draft) =>
      api.apiUploadFile({
        revisionId: draft.draftRevisionId,
        tableId: draft.tableId,
        rowId: draft.rowId,
        fileId: draft.file.fileId,
        file: createExpressImageFile(),
      }),
  },
  {
    name: 'createTable',
    write: (api, draft) =>
      api.apiCreateTable({
        revisionId: draft.draftRevisionId,
        tableId: 'created-table',
        schema: getObjectSchema({ name: getStringSchema() }),
      }),
  },
  {
    name: 'updateTable',
    write: (api, draft) =>
      api.apiUpdateTable({
        revisionId: draft.draftRevisionId,
        tableId: draft.tableId,
        patches: [
          { op: 'add', path: '/properties/name', value: getStringSchema() },
        ],
      }),
  },
  {
    name: 'renameTable',
    write: (api, draft) =>
      api.apiRenameTable({
        revisionId: draft.draftRevisionId,
        tableId: draft.tableId,
        nextTableId: 'renamed-table',
      }),
  },
  {
    name: 'removeTable',
    write: (api, draft) =>
      api.apiRemoveTable({
        revisionId: draft.draftRevisionId,
        tableId: draft.tableId,
      }),
  },
  {
    name: 'createRevision',
    write: (api, draft) =>
      api.apiCreateRevision({
        projectId: draft.projectId,
        branchName: draft.branchName,
      }),
  },
];

describe('Draft API writers under the migration lock', () => {
  it.each(writers)(
    '$name refuses when a migration starts before its transaction and writes nothing',
    async ({ write }) => {
      const draft = await givenDraftWithFileRow(kit);
      const contentBefore = await readDraftContent(kit, draft.draftRevisionId);

      await expect(
        writeWhileMigrationStarts(kit, draft, () =>
          write(kit.draftApiService, draft),
        ),
      ).rejects.toThrow(MigrationLockedException);

      await expect(
        readDraftContent(kit, draft.draftRevisionId),
      ).resolves.toEqual(contentBefore);
    },
  );

  let kit: DraftTestKit;

  beforeAll(async () => {
    kit = await createDraftTestKit({
      migrationOptions: { workerMode: 'disabled' },
    });
  });

  afterAll(async () => {
    await kit.close();
  });
});
