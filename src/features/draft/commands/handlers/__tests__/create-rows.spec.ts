import { BadRequestException } from '@nestjs/common';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { givenDraftProject } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import { createTestingModule } from 'src/features/draft/commands/handlers/__tests__/utils';
import { CreateRowsCommand } from 'src/features/draft/commands/impl/create-rows.command';
import { CreateRowsHandlerReturnType } from 'src/features/draft/commands/types/create-rows.handler.types';
import { SystemTables } from 'src/features/share/system-tables.consts';

describe('CreateRowsHandler', () => {
  let kit: DraftTestKit;

  it('should throw an error if any rowId is shorter than 1 character', async () => {
    const { draftRevisionId, tableId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new CreateRowsCommand({
      revisionId: draftRevisionId,
      tableId: tableId,
      rows: [
        { rowId: 'valid', data: { ver: 1 } },
        { rowId: '', data: { ver: 2 } },
      ],
    });

    await expect(runTransaction(command)).rejects.toThrow(BadRequestException);
    await expect(runTransaction(command)).rejects.toThrow(
      'Row ID must be 1 to ',
    );
  });

  it('should throw an error if the revision does not exist', async () => {
    await givenDraftProject(kit.prismaService);

    jest
      .spyOn(kit.draftTransactionalCommands, 'resolveDraftRevision')
      .mockRejectedValue(new Error('Revision not found'));

    const command = new CreateRowsCommand({
      revisionId: 'unreal',
      tableId: 'tableId',
      rows: [{ rowId: 'rowId', data: { ver: 3 } }],
    });

    await expect(runTransaction(command)).rejects.toThrow('Revision not found');
  });

  it('should throw an error if any row already exists', async () => {
    const { draftRevisionId, tableId, rowId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new CreateRowsCommand({
      revisionId: draftRevisionId,
      tableId: tableId,
      rows: [
        { rowId, data: { ver: 1 } },
        { rowId: 'newRow', data: { ver: 2 } },
      ],
    });

    await expect(runTransaction(command)).rejects.toThrow(
      'Rows already exist:',
    );
  });

  it('should throw an error if any data is not valid', async () => {
    const { draftRevisionId, tableId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new CreateRowsCommand({
      revisionId: draftRevisionId,
      tableId: tableId,
      rows: [
        { rowId: 'row1', data: { ver: 1 } },
        { rowId: 'row2', data: { ver: '3' } },
      ],
    });

    await expect(runTransaction(command)).rejects.toThrow(/must be number/);
  });

  it('should throw an error if the table is a system table', async () => {
    const { draftRevisionId, rowId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new CreateRowsCommand({
      revisionId: draftRevisionId,
      tableId: SystemTables.Schema,
      rows: [{ rowId, data: { ver: 3 } }],
    });

    await expect(runTransaction(command)).rejects.toThrow(
      'Table is a system table',
    );
  });

  it('should create multiple rows if conditions are met', async () => {
    const { draftRevisionId, tableId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new CreateRowsCommand({
      revisionId: draftRevisionId,
      tableId: tableId,
      rows: [
        { rowId: 'newRow1', data: { ver: 1 } },
        { rowId: 'newRow2', data: { ver: 2 } },
        { rowId: 'newRow3', data: { ver: 3 } },
      ],
    });

    const result = await runTransaction(command);

    expect(result.createdRows).toHaveLength(3);
    expect(result.createdRows[0]?.rowVersionId).toBeTruthy();
    expect(result.createdRows[1]?.rowVersionId).toBeTruthy();
    expect(result.createdRows[2]?.rowVersionId).toBeTruthy();

    const row1 = await kit.rowApiService.getRow({
      revisionId: draftRevisionId,
      tableId,
      rowId: 'newRow1',
    });
    const row2 = await kit.rowApiService.getRow({
      revisionId: draftRevisionId,
      tableId,
      rowId: 'newRow2',
    });
    const row3 = await kit.rowApiService.getRow({
      revisionId: draftRevisionId,
      tableId,
      rowId: 'newRow3',
    });

    expect(row1).not.toBeNull();
    expect(row1?.data).toStrictEqual({ ver: 1 });
    expect(row2).not.toBeNull();
    expect(row2?.data).toStrictEqual({ ver: 2 });
    expect(row3).not.toBeNull();
    expect(row3?.data).toStrictEqual({ ver: 3 });
  });

  it('should create a single row via bulk operation', async () => {
    const { draftRevisionId, tableId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new CreateRowsCommand({
      revisionId: draftRevisionId,
      tableId: tableId,
      rows: [{ rowId: 'singleRow', data: { ver: 42 } }],
    });

    const result = await runTransaction(command);

    expect(result.createdRows).toHaveLength(1);

    const row = await kit.rowApiService.getRow({
      revisionId: draftRevisionId,
      tableId,
      rowId: 'singleRow',
    });
    expect(row).not.toBeNull();
    expect(row?.data).toStrictEqual({ ver: 42 });
  });

  it('should pass isRestore=true to plugin service', async () => {
    const { draftRevisionId, tableId } = await givenDraftProject(
      kit.prismaService,
    );

    const afterCreateRowSpy = jest.spyOn(kit.pluginService, 'afterCreateRow');

    const command = new CreateRowsCommand({
      revisionId: draftRevisionId,
      tableId: tableId,
      rows: [{ rowId: 'restoreRow', data: { ver: 1 } }],
      isRestore: true,
    });

    await runTransaction(command);

    expect(afterCreateRowSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        isRestore: true,
      }),
    );
  });

  it('should pass isRestore=false (undefined) to plugin service by default', async () => {
    const { draftRevisionId, tableId } = await givenDraftProject(
      kit.prismaService,
    );

    const afterCreateRowSpy = jest.spyOn(kit.pluginService, 'afterCreateRow');

    const command = new CreateRowsCommand({
      revisionId: draftRevisionId,
      tableId: tableId,
      rows: [{ rowId: 'normalRow', data: { ver: 1 } }],
    });

    await runTransaction(command);

    expect(afterCreateRowSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        isRestore: undefined,
      }),
    );
  });

  function runTransaction(
    command: CreateRowsCommand,
  ): Promise<CreateRowsHandlerReturnType> {
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
