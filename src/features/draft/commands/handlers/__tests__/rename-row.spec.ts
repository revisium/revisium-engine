import { BadRequestException } from '@nestjs/common';
import {
  getArraySchema,
  getObjectSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import {
  prepareBranch,
  prepareProject,
  prepareRow,
  prepareTableWithSchema,
} from 'src/__tests__/utils/prepareProject';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import {
  givenDraftProject,
  givenDraftProjectWithSchema,
} from 'src/__tests__/fixtures/scenarios/given-draft-project';
import { createTestingModule } from 'src/features/draft/commands/handlers/__tests__/utils';
import {
  RenameRowCommand,
  RenameRowCommandReturnType,
} from 'src/features/draft/commands/impl/rename-row.command';
import { SystemTables } from 'src/features/share/system-tables.consts';

describe('RenameRowHandler', () => {
  const nextRowId = 'nextRowId';
  let kit: DraftTestKit;

  it('should throw an error if the rowId is shorter than 1 character', async () => {
    const { draftRevisionId, tableId, rowId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new RenameRowCommand({
      revisionId: draftRevisionId,
      tableId: tableId,
      rowId,
      nextRowId: '',
    });

    await expect(runTransaction(command)).rejects.toThrow(BadRequestException);
    await expect(runTransaction(command)).rejects.toThrow(
      'Row ID must be 1 to ',
    );
  });

  it('should throw an error if a similar row already exists', async () => {
    const { draftRevisionId, tableId, rowId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new RenameRowCommand({
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

    const command = new RenameRowCommand({
      revisionId: 'unreal',
      tableId,
      rowId,
      nextRowId,
    });

    await expect(runTransaction(command)).rejects.toThrow('Revision not found');
  });

  it('should throw an error if the table is a system table', async () => {
    const { draftRevisionId, tableId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new RenameRowCommand({
      revisionId: draftRevisionId,
      tableId: SystemTables.Schema,
      rowId: tableId,
      nextRowId,
    });

    await expect(runTransaction(command)).rejects.toThrow(
      'Table is a system table',
    );
  });

  it('should throw an error if the row does not exist', async () => {
    const { draftRevisionId, tableId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new RenameRowCommand({
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

    const command = new RenameRowCommand({
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

  it('should update itself foreign key references when the target is renamed', async () => {
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
    await prepareRow({
      prismaService: kit.prismaService,
      headTableVersionId: draft.headTableVersionId,
      draftTableVersionId: draft.draftTableVersionId,
      rowId: 'b',
      data: { refs: ['a'] },
      dataDraft: { refs: ['a'] },
      schema,
    });

    const command = new RenameRowCommand({
      revisionId: draft.draftRevisionId,
      tableId,
      rowId: 'a',
      nextRowId,
    });

    await runTransaction(command);

    const renamed = await kit.rowApiService.getRow({
      revisionId: draft.draftRevisionId,
      tableId,
      rowId: nextRowId,
    });
    expect(renamed).not.toBeNull();

    const referringRow = await kit.rowApiService.getRow({
      revisionId: draft.draftRevisionId,
      tableId,
      rowId: 'b',
    });
    expect(referringRow).not.toBeNull();
    expect(referringRow?.data).toStrictEqual({ refs: [nextRowId] });
  });

  it('should update the linked row', async () => {
    const { draftRevisionId, tableId, rowId, linkedTable, linkedRow } =
      await prepareProject(kit.prismaService, { createLinkedTable: true });
    const command = new RenameRowCommand({
      revisionId: draftRevisionId,
      tableId,
      rowId,
      nextRowId,
    });

    await runTransaction(command);

    const linkedTableId = linkedTable?.tableId ?? '';
    const linkedRowId = linkedRow?.rowId ?? '';
    const updatedLinkedRow = await kit.rowApiService.getRow({
      revisionId: draftRevisionId,
      tableId: linkedTableId,
      rowId: linkedRowId,
    });
    expect(updatedLinkedRow).not.toBeNull();
    expect(updatedLinkedRow?.data).toStrictEqual({ link: nextRowId });
  });

  it('should not modify publishedAt when renaming row', async () => {
    const { draftRevisionId, tableId, rowId, linkedTable, linkedRow } =
      await prepareProject(kit.prismaService, { createLinkedTable: true });

    const originalRow = await kit.prismaService.row.findFirstOrThrow({
      where: {
        id: linkedRow?.rowId,
        tables: {
          some: {
            id: linkedTable?.tableId,
            revisions: {
              some: {
                id: draftRevisionId,
              },
            },
          },
        },
      },
    });

    const originalPublishedAt = originalRow.publishedAt;
    expect(originalPublishedAt).toBeTruthy();

    const command = new RenameRowCommand({
      revisionId: draftRevisionId,
      tableId,
      rowId,
      nextRowId,
    });

    await runTransaction(command);

    const updatedRow = await kit.prismaService.row.findFirstOrThrow({
      where: {
        id: linkedRow?.rowId,
        tables: {
          some: {
            id: linkedTable?.tableId,
            revisions: {
              some: {
                id: draftRevisionId,
              },
            },
          },
        },
      },
    });

    expect(updatedRow.publishedAt).toStrictEqual(originalPublishedAt);
  });

  it('should update a same-table foreign key even when many other fields collide on the old id', async () => {
    const peopleTableId = 'people';
    const tasksTableId = 'tasks';
    const peopleSchema = getObjectSchema({
      name: getStringSchema(),
    });
    const tasksSchema = getObjectSchema({
      blockedBy: getArraySchema(getStringSchema({ foreignKey: tasksTableId })),
      assignee: getStringSchema({ foreignKey: peopleTableId }),
    });

    const branch = await prepareBranch(kit.prismaService);
    const people = await prepareTableWithSchema({
      prismaService: kit.prismaService,
      headRevisionId: branch.headRevisionId,
      draftRevisionId: branch.draftRevisionId,
      schemaTableVersionId: branch.schemaTableVersionId,
      migrationTableVersionId: branch.migrationTableVersionId,
      tableId: peopleTableId,
      schema: peopleSchema,
    });
    await prepareRow({
      prismaService: kit.prismaService,
      headTableVersionId: people.headTableVersionId,
      draftTableVersionId: people.draftTableVersionId,
      rowId: 'alex',
      data: { name: 'Alex' },
      dataDraft: { name: 'Alex' },
      schema: peopleSchema,
    });

    const tasks = await prepareTableWithSchema({
      prismaService: kit.prismaService,
      headRevisionId: branch.headRevisionId,
      draftRevisionId: branch.draftRevisionId,
      schemaTableVersionId: branch.schemaTableVersionId,
      migrationTableVersionId: branch.migrationTableVersionId,
      tableId: tasksTableId,
      schema: tasksSchema,
    });
    await prepareRow({
      prismaService: kit.prismaService,
      headTableVersionId: tasks.headTableVersionId,
      draftTableVersionId: tasks.draftTableVersionId,
      rowId: 'alex',
      data: { blockedBy: [], assignee: 'alex' },
      dataDraft: { blockedBy: [], assignee: 'alex' },
      schema: tasksSchema,
    });
    for (let index = 0; index < 99; index += 1) {
      const rowId = `b-${String(index).padStart(2, '0')}`;
      await prepareRow({
        prismaService: kit.prismaService,
        headTableVersionId: tasks.headTableVersionId,
        draftTableVersionId: tasks.draftTableVersionId,
        rowId,
        data: { blockedBy: ['alex'], assignee: '' },
        dataDraft: { blockedBy: ['alex'], assignee: '' },
        schema: tasksSchema,
      });
    }
    await prepareRow({
      prismaService: kit.prismaService,
      headTableVersionId: tasks.headTableVersionId,
      draftTableVersionId: tasks.draftTableVersionId,
      rowId: 'z-real',
      data: { blockedBy: [], assignee: 'alex' },
      dataDraft: { blockedBy: [], assignee: 'alex' },
      schema: tasksSchema,
    });

    const command = new RenameRowCommand({
      revisionId: branch.draftRevisionId,
      tableId: peopleTableId,
      rowId: 'alex',
      nextRowId: 'alex2',
    });

    await runTransaction(command);

    const updated = await kit.rowApiService.getRow({
      revisionId: branch.draftRevisionId,
      tableId: tasksTableId,
      rowId: 'z-real',
    });
    expect(updated?.data).toStrictEqual({
      blockedBy: [],
      assignee: 'alex2',
    });
  });

  function runTransaction(
    command: RenameRowCommand,
  ): Promise<RenameRowCommandReturnType> {
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
