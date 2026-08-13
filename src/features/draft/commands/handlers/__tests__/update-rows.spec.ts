import {
  getArraySchema,
  getObjectSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import {
  givenDraftProject,
  givenDraftProjectWithRows,
  givenDraftProjectWithSchema,
} from 'src/__tests__/fixtures/scenarios/given-draft-project';
import {
  createTestingModule,
  testSchema,
} from 'src/features/draft/commands/handlers/__tests__/utils';
import { CreateRowsCommand } from 'src/features/draft/commands/impl/create-rows.command';
import { UpdateRowsCommand } from 'src/features/draft/commands/impl/update-rows.command';
import { UpdateRowsHandlerReturnType } from 'src/features/draft/commands/types/update-rows.handler.types';
import { ForeignKeyRowsNotFoundException } from 'src/features/share/exceptions';
import { SystemTables } from 'src/features/share/system-tables.consts';

describe('UpdateRowsHandler', () => {
  let kit: DraftTestKit;

  it('should throw an error if the revision does not exist', async () => {
    const { draftRevisionId, tableId, rowId } = await givenDraftProject(
      kit.prismaService,
    );

    jest
      .spyOn(kit.draftTransactionalCommands, 'resolveDraftRevision')
      .mockRejectedValue(new Error('Revision not found'));

    const command = new UpdateRowsCommand({
      revisionId: draftRevisionId,
      tableId,
      rows: [{ rowId, data: { ver: 3 } }],
    });

    await expect(runTransaction(command)).rejects.toThrow('Revision not found');
  });

  it('should throw an error if the table is a system table', async () => {
    const { draftRevisionId, tableId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new UpdateRowsCommand({
      revisionId: draftRevisionId,
      tableId: SystemTables.Schema,
      rows: [{ rowId: tableId, data: { ver: 3 } }],
    });

    await expect(runTransaction(command)).rejects.toThrow(
      'Table is a system table',
    );
  });

  it('should throw an error if any row does not exist', async () => {
    const { draftRevisionId, tableId, rowId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new UpdateRowsCommand({
      revisionId: draftRevisionId,
      tableId,
      rows: [
        { rowId, data: { ver: 3 } },
        { rowId: 'unrealRow', data: { ver: 4 } },
      ],
    });

    await expect(runTransaction(command)).rejects.toThrow(
      'A row with this name does not exist in the revision',
    );
  });

  it('should throw an error if any data is not valid', async () => {
    const draft = await givenDraftProjectWithRows({
      prismaService: kit.prismaService,
      schema: testSchema,
      rows: [{ data: { ver: 10 }, draftData: { ver: 20 } }],
    });
    const row2Id = draft.extraRowIds[0];

    if (!row2Id) {
      throw new Error('Expected an extra row to be created');
    }

    const command = new UpdateRowsCommand({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      rows: [
        { rowId: draft.rowId, data: { ver: 3 } },
        { rowId: row2Id, data: { unrealKey: 3 } },
      ],
    });

    await expect(runTransaction(command)).rejects.toThrow(
      'missing required property "ver"',
    );
  });

  it('should update multiple rows if conditions are met', async () => {
    const draft = await givenDraftProjectWithRows({
      prismaService: kit.prismaService,
      schema: testSchema,
      rows: [{ data: { ver: 10 }, draftData: { ver: 20 } }],
    });
    const row2Id = draft.extraRowIds[0];

    if (!row2Id) {
      throw new Error('Expected an extra row to be created');
    }

    const command = new UpdateRowsCommand({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      rows: [
        { rowId: draft.rowId, data: { ver: 100 } },
        { rowId: row2Id, data: { ver: 200 } },
      ],
    });

    const result = await runTransaction(command);

    expect(result.updatedRows).toHaveLength(2);
    expect(result.updatedRows[0]?.rowVersionId).toBeTruthy();
    expect(result.updatedRows[1]?.rowVersionId).toBeTruthy();

    const updatedRow1 = await kit.rowApiService.getRow({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      rowId: draft.rowId,
    });
    const updatedRow2 = await kit.rowApiService.getRow({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      rowId: row2Id,
    });

    expect(updatedRow1).not.toBeNull();
    expect(updatedRow1?.data).toStrictEqual({ ver: 100 });
    expect(updatedRow2).not.toBeNull();
    expect(updatedRow2?.data).toStrictEqual({ ver: 200 });
  });

  it('should update a single row via bulk operation', async () => {
    const { draftRevisionId, tableId, rowId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new UpdateRowsCommand({
      revisionId: draftRevisionId,
      tableId,
      rows: [{ rowId, data: { ver: 999 } }],
    });

    const result = await runTransaction(command);

    expect(result.updatedRows).toHaveLength(1);

    const row = await kit.rowApiService.getRow({
      revisionId: draftRevisionId,
      tableId,
      rowId,
    });
    expect(row).not.toBeNull();
    expect(row?.data).toStrictEqual({ ver: 999 });
  });

  it('should pass isRestore=true to plugin service', async () => {
    const { draftRevisionId, tableId, rowId } = await givenDraftProject(
      kit.prismaService,
    );

    const afterUpdateRowSpy = jest.spyOn(kit.pluginService, 'afterUpdateRow');

    const command = new UpdateRowsCommand({
      revisionId: draftRevisionId,
      tableId,
      rows: [{ rowId, data: { ver: 42 } }],
      isRestore: true,
    });

    await runTransaction(command);

    expect(afterUpdateRowSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        isRestore: true,
      }),
    );
  });

  it('should pass isRestore=false (undefined) to plugin service by default', async () => {
    const { draftRevisionId, tableId, rowId } = await givenDraftProject(
      kit.prismaService,
    );

    const afterUpdateRowSpy = jest.spyOn(kit.pluginService, 'afterUpdateRow');

    const command = new UpdateRowsCommand({
      revisionId: draftRevisionId,
      tableId,
      rows: [{ rowId, data: { ver: 42 } }],
    });

    await runTransaction(command);

    expect(afterUpdateRowSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        isRestore: undefined,
      }),
    );
  });

  describe('itself foreign key', () => {
    it('should throw ForeignKeyRowsNotFoundException for a missing itself target and leave Draft unchanged', async () => {
      const tableId = 'nodes';
      const schema = getObjectSchema({
        refs: getArraySchema(getStringSchema({ foreignKey: tableId })),
      });
      const draft = await givenDraftProjectWithSchema({
        prismaService: kit.prismaService,
        tableId,
        schema,
        row: {
          rowId: 'a',
          data: { refs: [] },
          draftData: { refs: [] },
        },
      });

      const command = new UpdateRowsCommand({
        revisionId: draft.draftRevisionId,
        tableId,
        rows: [{ rowId: 'a', data: { refs: ['missing'] } }],
      });

      await expect(runTransaction(command)).rejects.toThrow(
        ForeignKeyRowsNotFoundException,
      );

      const row = await kit.rowApiService.getRow({
        revisionId: draft.draftRevisionId,
        tableId,
        rowId: 'a',
      });
      expect(row).not.toBeNull();
      expect(row?.data).toStrictEqual({ refs: [] });
    });

    it('should allow a cycle once both rows exist', async () => {
      const tableId = 'nodes';
      const schema = getObjectSchema({
        refs: getArraySchema(getStringSchema({ foreignKey: tableId })),
      });
      const draft = await givenDraftProjectWithSchema({
        prismaService: kit.prismaService,
        tableId,
        schema,
        row: {
          rowId: 'a',
          data: { refs: [] },
          draftData: { refs: [] },
        },
      });

      await kit.transactionService.run(async () =>
        kit.commandBus.execute(
          new CreateRowsCommand({
            revisionId: draft.draftRevisionId,
            tableId,
            rows: [{ rowId: 'b', data: { refs: ['a'] } }],
          }),
        ),
      );

      const command = new UpdateRowsCommand({
        revisionId: draft.draftRevisionId,
        tableId,
        rows: [{ rowId: 'a', data: { refs: ['b'] } }],
      });

      const result = await runTransaction(command);
      expect(result.updatedRows).toHaveLength(1);

      const rowA = await kit.rowApiService.getRow({
        revisionId: draft.draftRevisionId,
        tableId,
        rowId: 'a',
      });
      const rowB = await kit.rowApiService.getRow({
        revisionId: draft.draftRevisionId,
        tableId,
        rowId: 'b',
      });
      expect(rowA?.data).toStrictEqual({ refs: ['b'] });
      expect(rowB?.data).toStrictEqual({ refs: ['a'] });
    });
  });

  function runTransaction(
    command: UpdateRowsCommand,
  ): Promise<UpdateRowsHandlerReturnType> {
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
