import hash from 'object-hash';
import { prepareProject, prepareRow } from 'src/__tests__/utils/prepareProject';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import {
  givenDraftProject,
  givenDraftProjectWithRows,
} from 'src/__tests__/fixtures/scenarios/given-draft-project';
import {
  getArraySchema,
  getNumberSchema,
  getObjectSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import {
  createTestingModule,
  testSchema,
} from 'src/features/draft/commands/handlers/__tests__/utils';
import { PatchRowsCommand } from 'src/features/draft/commands/impl/patch-rows.command';
import { PatchRowsHandlerReturnType } from 'src/features/draft/commands/types/patch-rows.handler.types';

describe('PatchRowsHandler', () => {
  let kit: DraftTestKit;

  it('should throw an error if any data is invalid', async () => {
    const draft = await givenDraftProjectWithRows({
      prismaService: kit.prismaService,
      schema: testSchema,
      rows: [{ data: { ver: 10 }, draftData: { ver: 20 } }],
    });
    const row2Id = draft.extraRowIds[0];

    if (!row2Id) {
      throw new Error('Expected an extra row to be created');
    }

    const command = new PatchRowsCommand({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      rows: [
        {
          rowId: draft.rowId,
          patches: [{ op: 'replace', path: 'ver', value: 100 }],
        },
        {
          rowId: row2Id,
          patches: [{ op: 'replace', path: 'ver', value: true }],
        },
      ],
    });

    await expect(runTransaction(command)).rejects.toThrow(/must be number/);
  });

  it('should throw an error if any path is invalid', async () => {
    const draft = await givenDraftProjectWithRows({
      prismaService: kit.prismaService,
      schema: testSchema,
      rows: [{ data: { ver: 10 }, draftData: { ver: 20 } }],
    });
    const row2Id = draft.extraRowIds[0];

    if (!row2Id) {
      throw new Error('Expected an extra row to be created');
    }

    const command = new PatchRowsCommand({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      rows: [
        {
          rowId: draft.rowId,
          patches: [{ op: 'replace', path: 'ver', value: 100 }],
        },
        {
          rowId: row2Id,
          patches: [{ op: 'replace', path: 'invalid', value: 1 }],
        },
      ],
    });

    await expect(runTransaction(command)).rejects.toThrow(
      'Path not found at segment "invalid"',
    );
  });

  it('should throw an error if any row does not exist', async () => {
    const { draftRevisionId, tableId, rowId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new PatchRowsCommand({
      revisionId: draftRevisionId,
      tableId,
      rows: [
        { rowId, patches: [{ op: 'replace', path: 'ver', value: 100 }] },
        {
          rowId: 'invalid',
          patches: [{ op: 'replace', path: 'ver', value: 1 }],
        },
      ],
    });

    await expect(runTransaction(command)).rejects.toThrow('Rows not found');
  });

  it('should patch multiple rows if conditions are met', async () => {
    const ids = await prepareProject(kit.prismaService);
    const {
      draftRevisionId,
      tableId,
      rowId,
      schemaRowVersionId,
      draftRowVersionId,
      headTableVersionId,
      draftTableVersionId,
    } = ids;

    const newSchema = getObjectSchema({
      str: getStringSchema(),
      num: getNumberSchema(),
      list: getArraySchema(getNumberSchema()),
    });

    await kit.prismaService.row.update({
      where: { versionId: schemaRowVersionId },
      data: { data: newSchema, hash: hash(newSchema) },
    });

    await kit.prismaService.row.update({
      where: { versionId: draftRowVersionId },
      data: {
        data: { str: 'str1', num: 1, list: [1, 2, 3] },
        schemaHash: hash(newSchema),
      },
    });

    const row2 = await prepareRow({
      prismaService: kit.prismaService,
      headTableVersionId,
      draftTableVersionId,
      rowId: 'row-2',
      data: { str: 'str2', num: 10, list: [10] },
      dataDraft: { str: 'str2', num: 10, list: [10] },
      schema: newSchema,
    });

    const command = new PatchRowsCommand({
      revisionId: draftRevisionId,
      tableId,
      rows: [
        {
          rowId,
          patches: [
            { op: 'replace', path: 'str', value: 'updated1' },
            { op: 'replace', path: 'num', value: 100 },
          ],
        },
        {
          rowId: row2.rowId,
          patches: [
            { op: 'replace', path: 'str', value: 'updated2' },
            { op: 'replace', path: 'list[0]', value: 999 },
          ],
        },
      ],
    });

    const result = await runTransaction(command);
    expect(result.patchedRows).toHaveLength(2);

    const updatedRow1 = await kit.rowApiService.getRow({
      revisionId: draftRevisionId,
      tableId,
      rowId,
    });
    const updatedRow2 = await kit.rowApiService.getRow({
      revisionId: draftRevisionId,
      tableId,
      rowId: row2.rowId,
    });

    expect(updatedRow1?.data).toStrictEqual({
      str: 'updated1',
      num: 100,
      list: [1, 2, 3],
    });
    expect(updatedRow2?.data).toStrictEqual({
      str: 'updated2',
      num: 10,
      list: [999],
    });
  });

  it('should patch a single row via bulk operation', async () => {
    const { draftRevisionId, tableId, rowId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new PatchRowsCommand({
      revisionId: draftRevisionId,
      tableId,
      rows: [{ rowId, patches: [{ op: 'replace', path: 'ver', value: 999 }] }],
    });

    const result = await runTransaction(command);

    expect(result.patchedRows).toHaveLength(1);

    const row = await kit.rowApiService.getRow({
      revisionId: draftRevisionId,
      tableId,
      rowId,
    });
    expect(row?.data).toStrictEqual({ ver: 999 });
  });

  function runTransaction(
    command: PatchRowsCommand,
  ): Promise<PatchRowsHandlerReturnType> {
    return kit.transactionService.run(async () =>
      kit.commandBus.execute(command),
    );
  }

  beforeAll(async () => {
    kit = await createTestingModule();
  });

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    if (kit) {
      await kit.close();
    }
  });
});
