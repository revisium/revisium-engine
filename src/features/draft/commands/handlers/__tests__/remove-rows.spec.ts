import { nanoid } from 'nanoid';
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
  givenDraftProjectWithRows,
  givenDraftProjectWithSchema,
} from 'src/__tests__/fixtures/scenarios/given-draft-project';
import {
  createTestingModule,
  testSchema,
} from 'src/features/draft/commands/handlers/__tests__/utils';
import { RemoveRowsCommand } from 'src/features/draft/commands/impl/remove-rows.command';
import { RemoveRowsHandlerReturnType } from 'src/features/draft/commands/types/remove-rows.handler.types';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { JsonSchemaTypeName } from '@revisium/schema-toolkit/types';

describe('RemoveRowsHandler', () => {
  let kit: DraftTestKit;

  it('should throw an error if the revision does not exist', async () => {
    const { tableId, rowId } = await givenDraftProject(kit.prismaService);

    const command = new RemoveRowsCommand({
      revisionId: 'unreal',
      tableId,
      rowIds: [rowId],
    });

    await expect(runTransaction(command)).rejects.toThrow('Revision not found');
  });

  it('should throw an error if row does not exist', async () => {
    const { draftRevisionId, tableId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new RemoveRowsCommand({
      revisionId: draftRevisionId,
      tableId,
      rowIds: ['unreal'],
    });

    await expect(runTransaction(command)).rejects.toThrow(
      'Rows not found in table: unreal',
    );
  });

  it('should throw an error if the table is a system table', async () => {
    const { draftRevisionId, rowId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new RemoveRowsCommand({
      revisionId: draftRevisionId,
      tableId: SystemTables.Schema,
      rowIds: [rowId],
    });

    await expect(runTransaction(command)).rejects.toThrow(
      'Table is a system table',
    );
  });

  it('should throw an error if the foreignKey exists', async () => {
    const { draftRevisionId, schemaTableVersionId, tableId, rowId } =
      await prepareProject(kit.prismaService);
    const anotherTableId = nanoid();
    const anotherTableVersionId = nanoid();
    const anotherRowId = nanoid();
    const anotherRowVersionId = nanoid();

    // table
    await kit.prismaService.table.create({
      data: {
        id: anotherTableId,
        createdId: nanoid(),
        readonly: false,
        versionId: anotherTableVersionId,
        revisions: {
          connect: {
            id: draftRevisionId,
          },
        },
      },
    });
    // schema for table
    await kit.prismaService.row.create({
      data: {
        id: anotherTableId,
        readonly: false,
        createdId: nanoid(),
        versionId: nanoid(),
        tables: {
          connect: {
            versionId: schemaTableVersionId,
          },
        },
        data: {
          type: JsonSchemaTypeName.Object,
          properties: {
            ref: {
              type: JsonSchemaTypeName.String,
              foreignKey: tableId,
              default: '',
            },
          },
          required: ['ref'],
        },
        hash: '',
        schemaHash: '',
      },
    });
    // row for another table
    await kit.prismaService.row.create({
      data: {
        id: anotherRowId,
        readonly: false,
        createdId: nanoid(),
        versionId: anotherRowVersionId,
        tables: {
          connect: {
            versionId: anotherTableVersionId,
          },
        },
        data: {
          ref: rowId,
        },
        hash: '',
        schemaHash: '',
      },
    });

    const command = new RemoveRowsCommand({
      revisionId: draftRevisionId,
      tableId,
      rowIds: [rowId],
    });

    await expect(runTransaction(command)).rejects.toThrow(
      'The row is related to other rows',
    );
  });

  it('should remove the row if conditions are met', async () => {
    const { draftRevisionId, tableId, rowId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new RemoveRowsCommand({
      revisionId: draftRevisionId,
      tableId,
      rowIds: [rowId],
    });

    const result = await runTransaction(command);
    expect(result.tableVersionId).toBeTruthy();

    const row = await kit.rowApiService.getRow({
      revisionId: draftRevisionId,
      tableId,
      rowId,
    });
    expect(row).toBeNull();
  });

  it('should remove the row if conditions are met and if the table is a system table and skipCheckingNotSystemTable = true', async () => {
    const { draftRevisionId, tableId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new RemoveRowsCommand({
      revisionId: draftRevisionId,
      tableId: SystemTables.Schema,
      avoidCheckingSystemTable: true,
      rowIds: [tableId],
    });

    const result = await runTransaction(command);

    expect(result).toBeTruthy();
  });

  // ==================== Multiple rows tests ====================

  it('should remove multiple rows successfully', async () => {
    const draft = await givenDraftProjectWithRows({
      prismaService: kit.prismaService,
      schema: testSchema,
      rows: [{ data: { ver: 10 } }, { data: { ver: 20 } }],
    });
    const [row2Id, row3Id] = draft.extraRowIds;

    if (!row2Id || !row3Id) {
      throw new Error('Expected two extra rows to be created');
    }

    const command = new RemoveRowsCommand({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      rowIds: [draft.rowId, row2Id, row3Id],
    });

    const result = await runTransaction(command);
    expect(result.tableVersionId).toBeTruthy();

    for (const id of [draft.rowId, row2Id, row3Id]) {
      const row = await kit.rowApiService.getRow({
        revisionId: draft.draftRevisionId,
        tableId: draft.tableId,
        rowId: id,
      });
      expect(row).toBeNull();
    }
  });

  it('should throw an error if one row exists but another does not', async () => {
    const { draftRevisionId, tableId, rowId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new RemoveRowsCommand({
      revisionId: draftRevisionId,
      tableId,
      rowIds: [rowId, 'non-existent-row'],
    });

    await expect(runTransaction(command)).rejects.toThrow(
      'Rows not found in table: non-existent-row',
    );

    const row = await kit.rowApiService.getRow({
      revisionId: draftRevisionId,
      tableId,
      rowId,
    });
    expect(row).not.toBeNull();
  });

  it('should throw an error if one row has foreignKey dependency but another does not', async () => {
    const {
      draftRevisionId,
      schemaTableVersionId,
      tableId,
      rowId,
      draftTableVersionId,
    } = await prepareProject(kit.prismaService);

    const row2Id = nanoid();
    await kit.prismaService.row.create({
      data: {
        id: row2Id,
        versionId: nanoid(),
        createdId: nanoid(),
        readonly: false,
        data: {},
        hash: '',
        schemaHash: '',
        tables: {
          connect: { versionId: draftTableVersionId },
        },
      },
    });

    const anotherTableId = nanoid();
    const anotherTableVersionId = nanoid();
    await kit.prismaService.table.create({
      data: {
        id: anotherTableId,
        createdId: nanoid(),
        readonly: false,
        versionId: anotherTableVersionId,
        revisions: { connect: { id: draftRevisionId } },
      },
    });
    await kit.prismaService.row.create({
      data: {
        id: anotherTableId,
        readonly: false,
        createdId: nanoid(),
        versionId: nanoid(),
        tables: { connect: { versionId: schemaTableVersionId } },
        data: {
          type: JsonSchemaTypeName.Object,
          properties: {
            ref: {
              type: JsonSchemaTypeName.String,
              foreignKey: tableId,
              default: '',
            },
          },
          required: ['ref'],
        },
        hash: '',
        schemaHash: '',
      },
    });
    await kit.prismaService.row.create({
      data: {
        id: nanoid(),
        readonly: false,
        createdId: nanoid(),
        versionId: nanoid(),
        tables: { connect: { versionId: anotherTableVersionId } },
        data: { ref: rowId },
        hash: '',
        schemaHash: '',
      },
    });

    const command = new RemoveRowsCommand({
      revisionId: draftRevisionId,
      tableId,
      rowIds: [row2Id, rowId],
    });

    await expect(runTransaction(command)).rejects.toThrow(
      'The row is related to other rows',
    );

    const row1 = await kit.rowApiService.getRow({
      revisionId: draftRevisionId,
      tableId,
      rowId,
    });
    const row2 = await kit.rowApiService.getRow({
      revisionId: draftRevisionId,
      tableId,
      rowId: row2Id,
    });
    expect(row1).not.toBeNull();
    expect(row2).not.toBeNull();
  });

  // ==================== Edge case tests ====================

  it('should throw an error if rowIds is empty', async () => {
    const { draftRevisionId, tableId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new RemoveRowsCommand({
      revisionId: draftRevisionId,
      tableId,
      rowIds: [],
    });

    await expect(runTransaction(command)).rejects.toThrow(
      'rowIds array cannot be empty',
    );
  });

  it('should handle duplicate rowIds correctly', async () => {
    const { draftRevisionId, tableId, rowId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new RemoveRowsCommand({
      revisionId: draftRevisionId,
      tableId,
      rowIds: [rowId, rowId, rowId],
    });

    const result = await runTransaction(command);
    expect(result.tableVersionId).toBeTruthy();

    const row = await kit.rowApiService.getRow({
      revisionId: draftRevisionId,
      tableId,
      rowId,
    });
    expect(row).toBeNull();
  });

  describe('itself foreign key', () => {
    it('should throw when another remaining row references the target', async () => {
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

      const command = new RemoveRowsCommand({
        revisionId: draft.draftRevisionId,
        tableId,
        rowIds: ['a'],
      });

      await expect(runTransaction(command)).rejects.toThrow(
        'The row is related to other rows',
      );

      const rowA = await kit.rowApiService.getRow({
        revisionId: draft.draftRevisionId,
        tableId,
        rowId: 'a',
      });
      expect(rowA).not.toBeNull();
    });

    it('should remove a mutually referencing set together', async () => {
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
          data: { refs: ['b'] },
          draftData: { refs: ['b'] },
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

      const command = new RemoveRowsCommand({
        revisionId: draft.draftRevisionId,
        tableId,
        rowIds: ['a', 'b'],
      });

      const result = await runTransaction(command);
      expect(result.tableVersionId).toBeTruthy();

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
      expect(rowA).toBeNull();
      expect(rowB).toBeNull();
    });

    it('should remove a row that only references itself', async () => {
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
          data: { refs: ['a'] },
          draftData: { refs: ['a'] },
        },
      });

      const command = new RemoveRowsCommand({
        revisionId: draft.draftRevisionId,
        tableId,
        rowIds: ['a'],
      });

      const result = await runTransaction(command);
      expect(result.tableVersionId).toBeTruthy();

      const rowA = await kit.rowApiService.getRow({
        revisionId: draft.draftRevisionId,
        tableId,
        rowId: 'a',
      });
      expect(rowA).toBeNull();
    });

    it('should not block removal when a remaining row matches the id only on a foreign key to another table', async () => {
      const peopleTableId = 'people';
      const tasksTableId = 'tasks';
      const peopleSchema = getObjectSchema({
        name: getStringSchema(),
      });
      const tasksSchema = getObjectSchema({
        blockedBy: getArraySchema(
          getStringSchema({ foreignKey: tasksTableId }),
        ),
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
      await prepareRow({
        prismaService: kit.prismaService,
        headTableVersionId: tasks.headTableVersionId,
        draftTableVersionId: tasks.draftTableVersionId,
        rowId: 'task-2',
        data: { blockedBy: [], assignee: 'alex' },
        dataDraft: { blockedBy: [], assignee: 'alex' },
        schema: tasksSchema,
      });

      const command = new RemoveRowsCommand({
        revisionId: branch.draftRevisionId,
        tableId: tasksTableId,
        rowIds: ['alex'],
      });

      const result = await runTransaction(command);
      expect(result.tableVersionId).toBeTruthy();

      const deletedTask = await kit.rowApiService.getRow({
        revisionId: branch.draftRevisionId,
        tableId: tasksTableId,
        rowId: 'alex',
      });
      const remainingTask = await kit.rowApiService.getRow({
        revisionId: branch.draftRevisionId,
        tableId: tasksTableId,
        rowId: 'task-2',
      });
      expect(deletedTask).toBeNull();
      expect(remainingTask).not.toBeNull();
    });
  });

  it('should keep draft-only table when all rows removed (not in head)', async () => {
    const { draftRevisionId } = await givenDraftProject(kit.prismaService);

    const newTableId = nanoid();
    const newTableVersionId = nanoid();
    await kit.prismaService.table.create({
      data: {
        id: newTableId,
        versionId: newTableVersionId,
        createdId: nanoid(),
        readonly: false,
        revisions: {
          connect: { id: draftRevisionId },
        },
      },
    });

    const rowId = nanoid();
    await kit.prismaService.row.create({
      data: {
        id: rowId,
        versionId: nanoid(),
        createdId: nanoid(),
        readonly: false,
        data: {},
        hash: '',
        schemaHash: '',
        tables: {
          connect: { versionId: newTableVersionId },
        },
      },
    });

    const command = new RemoveRowsCommand({
      revisionId: draftRevisionId,
      tableId: newTableId,
      rowIds: [rowId],
      avoidCheckingSystemTable: true,
    });

    const result = await runTransaction(command);
    expect(result.tableVersionId).toBeTruthy();

    const row = await kit.prismaService.row.findFirst({
      where: {
        id: rowId,
        tables: {
          some: {
            id: newTableId,
            revisions: { some: { id: draftRevisionId } },
          },
        },
      },
    });
    expect(row).toBeNull();

    const table = await kit.prismaService.table.findFirst({
      where: {
        id: newTableId,
        revisions: { some: { id: draftRevisionId } },
      },
    });
    expect(table).not.toBeNull();
    expect(table?.versionId).toBe(newTableVersionId);
  });

  function runTransaction(
    command: RemoveRowsCommand,
  ): Promise<RemoveRowsHandlerReturnType> {
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
