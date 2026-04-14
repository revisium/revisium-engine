import { BadRequestException } from '@nestjs/common';
import { prepareProject } from 'src/__tests__/utils/prepareProject';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { givenDraftProject } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import {
  InternalRenameRowCommand,
  InternalRenameRowCommandReturnType,
} from 'src/features/draft/commands/impl/transactional/internal-rename-row.command';
import { createTestingModule } from 'src/features/draft/commands/handlers/__tests__/utils';

describe('InternalRenameRowHandler', () => {
  const nextRowId = 'nextRowId';
  let kit: DraftTestKit;

  it('should throw an error if the rowId is shorter than 1 character', async () => {
    const { draftRevisionId, tableId, rowId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new InternalRenameRowCommand({
      revisionId: draftRevisionId,
      tableId: tableId,
      rowId,
      nextRowId: '',
    });

    await expect(runTransaction(command)).rejects.toThrow(BadRequestException);
    await expect(runTransaction(command)).rejects.toThrow(
      'Row ID must be 1 to 64 characters and contain only letters (a-z, A-Z), digits (0-9), underscores (_), and hyphens (-).',
    );
  });

  it('should throw an error if rowId equals nextRowId', async () => {
    const { draftRevisionId, tableId, rowId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new InternalRenameRowCommand({
      revisionId: draftRevisionId,
      tableId: tableId,
      rowId: rowId,
      nextRowId: rowId,
    });

    await expect(runTransaction(command)).rejects.toThrow(
      'New ID must be different from current',
    );
  });

  it('should throw an error if the revision does not exist', async () => {
    const { tableId, rowId } = await givenDraftProject(kit.prismaService);

    const command = new InternalRenameRowCommand({
      revisionId: 'unreal',
      tableId,
      rowId,
      nextRowId,
    });

    await expect(runTransaction(command)).rejects.toThrow('Revision not found');
  });

  it('should throw an error if the row does not exist', async () => {
    const { draftRevisionId, tableId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new InternalRenameRowCommand({
      revisionId: draftRevisionId,
      tableId,
      rowId: 'unrealRow',
      nextRowId,
    });

    await expect(runTransaction(command)).rejects.toThrow(
      'Row "unrealRow" not found in table',
    );
  });

  it('should rename the row if conditions are met', async () => {
    const { draftRevisionId, tableId, rowId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new InternalRenameRowCommand({
      revisionId: draftRevisionId,
      tableId,
      rowId,
      nextRowId,
    });

    const result = await runTransaction(command);
    expect(result.rowVersionId).toBeTruthy();

    const oldRow = await kit.rowApiService.getRow({
      revisionId: draftRevisionId,
      tableId,
      rowId,
    });
    expect(oldRow).toBeNull();

    const newRow = await kit.rowApiService.getRow({
      revisionId: draftRevisionId,
      tableId,
      rowId: nextRowId,
    });
    expect(newRow).not.toBeNull();
    expect(newRow?.id).toBe(nextRowId);
  });

  it('should update foreign keys in linked rows when renaming a row', async () => {
    const { draftRevisionId, tableId, rowId, linkedTable, linkedRow } =
      await prepareProject(kit.prismaService, { createLinkedTable: true });

    const command = new InternalRenameRowCommand({
      revisionId: draftRevisionId,
      tableId,
      rowId,
      nextRowId,
    });

    await runTransaction(command);

    const updatedLinkedRow = await kit.rowApiService.getRow({
      revisionId: draftRevisionId,
      tableId: linkedTable?.tableId as string,
      rowId: linkedRow?.rowId as string,
    });

    expect(updatedLinkedRow?.data).toStrictEqual({ link: nextRowId });
  });

  function runTransaction(
    command: InternalRenameRowCommand,
  ): Promise<InternalRenameRowCommandReturnType> {
    return kit.transactionService.run(async () =>
      kit.commandBus.execute(command),
    );
  }

  beforeAll(async () => {
    kit = await createTestingModule();
  });

  afterAll(async () => {
    if (kit) {
      await kit.close();
    }
  });
});
