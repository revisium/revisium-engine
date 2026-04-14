import { BadRequestException } from '@nestjs/common';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { givenDraftProject } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import {
  InternalCreateRowCommand,
  InternalCreateRowCommandReturnType,
} from 'src/features/draft/commands/impl/transactional/internal-create-row.command';
import {
  createTestingModule,
  testSchema,
} from 'src/features/draft/commands/handlers/__tests__/utils';
import objectHash from 'object-hash';

describe('InternalCreateRowHandler', () => {
  let kit: DraftTestKit;

  it('should throw an error if the rowId is shorter than 1 character', async () => {
    const { draftRevisionId, tableId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new InternalCreateRowCommand({
      revisionId: draftRevisionId,
      tableId: tableId,
      rowId: '',
      data: { ver: 3 },
      schemaHash: objectHash(testSchema),
    });

    await expect(runTransaction(command)).rejects.toThrow(BadRequestException);
    await expect(runTransaction(command)).rejects.toThrow(
      'Row ID must be 1 to 64 characters and contain only letters (a-z, A-Z), digits (0-9), underscores (_), and hyphens (-).',
    );
  });

  it('should throw an error if the revision does not exist', async () => {
    await givenDraftProject(kit.prismaService);

    const command = new InternalCreateRowCommand({
      revisionId: 'unreal',
      tableId: 'tableId',
      rowId: 'rowId',
      data: { ver: 3 },
      schemaHash: objectHash(testSchema),
    });

    await expect(runTransaction(command)).rejects.toThrow('Revision not found');
  });

  it('should throw an error if a similar row already exists', async () => {
    const { draftRevisionId, tableId, rowId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new InternalCreateRowCommand({
      revisionId: draftRevisionId,
      tableId: tableId,
      rowId: rowId,
      data: { ver: 3 },
      schemaHash: objectHash(testSchema),
    });

    await expect(runTransaction(command)).rejects.toThrow(
      'Rows already exist:',
    );
  });

  it('should create a new row if conditions are met', async () => {
    const { draftRevisionId, tableId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new InternalCreateRowCommand({
      revisionId: draftRevisionId,
      tableId: tableId,
      rowId: 'newRowId',
      data: { ver: 3 },
      schemaHash: objectHash(testSchema),
    });

    const result = await runTransaction(command);
    expect(result.rowVersionId).toBeTruthy();

    const row = await kit.rowApiService.getRow({
      revisionId: draftRevisionId,
      tableId,
      rowId: 'newRowId',
    });
    expect(row).not.toBeNull();
    expect(row?.id).toBe('newRowId');
    expect(row?.data).toStrictEqual({ ver: 3 });
  });

  it('should save the optional publishedAt field', async () => {
    const { draftRevisionId, tableId } = await givenDraftProject(
      kit.prismaService,
    );

    const publishedAtDate = new Date('2027-01-01T00:00:00.000Z');

    const command = new InternalCreateRowCommand({
      revisionId: draftRevisionId,
      tableId: tableId,
      rowId: 'newRowId',
      data: { ver: 3 },
      schemaHash: objectHash(testSchema),
      publishedAt: publishedAtDate.toISOString(),
    });

    const result = await runTransaction(command);
    expect(result.rowVersionId).toBeTruthy();

    const row = await kit.rowApiService.getRow({
      revisionId: draftRevisionId,
      tableId,
      rowId: 'newRowId',
    });
    expect(row).not.toBeNull();
    expect(row?.id).toBe('newRowId');
    expect(row?.data).toStrictEqual({ ver: 3 });
  });

  function runTransaction(
    command: InternalCreateRowCommand,
  ): Promise<InternalCreateRowCommandReturnType> {
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
