import { nanoid } from 'nanoid';
import {
  getObjectSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import { prepareProject } from 'src/__tests__/utils/prepareProject';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import {
  givenDraftProject,
  givenDraftProjectWithSchema,
} from 'src/__tests__/fixtures/scenarios/given-draft-project';
import { createTestingModule } from 'src/features/draft/commands/handlers/__tests__/utils';
import { RemoveTableCommand } from 'src/features/draft/commands/impl/remove-table.command';
import { RemoveTableHandlerReturnType } from 'src/features/draft/commands/types/remove-table.handler.types';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { JsonSchemaTypeName } from '@revisium/schema-toolkit/types';

describe('RemoveTableHandler', () => {
  let kit: DraftTestKit;

  it('should throw an error if the revision does not exist', async () => {
    const { tableId } = await givenDraftProject(kit.prismaService);

    const command = new RemoveTableCommand({
      revisionId: 'unreal',
      tableId,
    });

    await expect(runTransaction(command)).rejects.toThrow('Revision not found');
  });

  it('should throw an error if findTableInRevisionOrThrow fails', async () => {
    const { draftRevisionId } = await givenDraftProject(kit.prismaService);

    const command = new RemoveTableCommand({
      revisionId: draftRevisionId,
      tableId: 'unreal',
    });

    await expect(runTransaction(command)).rejects.toThrow(
      'A table with this name does not exist in the revision',
    );
  });

  it('should throw an error if the table is a system table', async () => {
    const { draftRevisionId } = await givenDraftProject(kit.prismaService);

    const command = new RemoveTableCommand({
      revisionId: draftRevisionId,
      tableId: SystemTables.Schema,
    });

    await expect(runTransaction(command)).rejects.toThrow(
      'Table is a system table',
    );
  });

  it('should throw an error if the foreign keys exists', async () => {
    const { draftRevisionId, schemaTableVersionId, tableId } =
      await prepareProject(kit.prismaService);
    const anotherTableId = nanoid();
    const anotherTableVersionId = nanoid();

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
    const data = {
      type: JsonSchemaTypeName.Object,
      properties: {
        ref: {
          type: JsonSchemaTypeName.String,
          foreignKey: tableId,
          default: '',
        },
      },
    };
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
        data,
        hash: '',
        schemaHash: '',
      },
    });

    const command = new RemoveTableCommand({
      revisionId: draftRevisionId,
      tableId,
    });

    await expect(runTransaction(command)).rejects.toThrow(
      `There are foreign keys between ${tableId} and [${anotherTableId}]`,
    );
  });

  it('should remove a table that only has itself foreign key', async () => {
    const tableId = 'locations';
    const schema = getObjectSchema({
      parentId: getStringSchema({ foreignKey: tableId }),
    });
    const draft = await givenDraftProjectWithSchema({
      prismaService: kit.prismaService,
      tableId,
      schema,
      row: {
        rowId: 'root',
        data: { parentId: 'root' },
        draftData: { parentId: 'root' },
      },
    });

    const command = new RemoveTableCommand({
      revisionId: draft.draftRevisionId,
      tableId,
    });

    const result = await runTransaction(command);
    expect(result.revisionId).toBe(draft.draftRevisionId);

    const table = await kit.tableApiService.getTable({
      revisionId: draft.draftRevisionId,
      tableId,
    });
    expect(table).toBeNull();
  });

  it('should remove the table if conditions are met', async () => {
    const { draftRevisionId, tableId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new RemoveTableCommand({
      revisionId: draftRevisionId,
      tableId,
    });

    const result = await runTransaction(command);
    expect(result.revisionId).toBe(draftRevisionId);

    const table = await kit.tableApiService.getTable({
      revisionId: draftRevisionId,
      tableId,
    });
    expect(table).toBeNull();
  });

  describe('views integration', () => {
    it('should remove views row when removing table that has views configured', async () => {
      const { draftRevisionId, tableId } = await givenDraftProject(
        kit.prismaService,
      );

      const viewsTableVersionId = nanoid();
      await kit.prismaService.table.create({
        data: {
          id: SystemTables.Views,
          versionId: viewsTableVersionId,
          createdId: nanoid(),
          readonly: false,
          system: true,
          revisions: {
            connect: { id: draftRevisionId },
          },
        },
      });

      await kit.prismaService.row.create({
        data: {
          id: tableId,
          versionId: nanoid(),
          createdId: nanoid(),
          readonly: false,
          data: {
            version: 1,
            defaultViewId: 'default',
            views: [{ id: 'default', name: 'Default' }],
          },
          hash: '',
          schemaHash: '',
          tables: {
            connect: { versionId: viewsTableVersionId },
          },
        },
      });

      const viewsRowBefore = await kit.prismaService.row.findFirst({
        where: {
          id: tableId,
          tables: { some: { versionId: viewsTableVersionId } },
        },
      });
      expect(viewsRowBefore).not.toBeNull();

      const command = new RemoveTableCommand({
        revisionId: draftRevisionId,
        tableId,
      });
      await runTransaction(command);

      const viewsRowAfter = await kit.prismaService.row.findFirst({
        where: {
          id: tableId,
          tables: { some: { versionId: viewsTableVersionId } },
        },
      });
      expect(viewsRowAfter).toBeNull();
    });

    it('should not fail when removing table without views', async () => {
      const { draftRevisionId, tableId } = await givenDraftProject(
        kit.prismaService,
      );

      const command = new RemoveTableCommand({
        revisionId: draftRevisionId,
        tableId,
      });

      await expect(runTransaction(command)).resolves.toBeDefined();
    });

    it('should not fail when views table exists but no views row for table', async () => {
      const { draftRevisionId, tableId } = await givenDraftProject(
        kit.prismaService,
      );

      await kit.prismaService.table.create({
        data: {
          id: SystemTables.Views,
          versionId: nanoid(),
          createdId: nanoid(),
          readonly: false,
          system: true,
          revisions: {
            connect: { id: draftRevisionId },
          },
        },
      });

      const command = new RemoveTableCommand({
        revisionId: draftRevisionId,
        tableId,
      });

      await expect(runTransaction(command)).resolves.toBeDefined();
    });
  });

  function runTransaction(
    command: RemoveTableCommand,
  ): Promise<RemoveTableHandlerReturnType> {
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
