import { prepareProject } from 'src/__tests__/utils/prepareProject';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { givenDraftProject } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import {
  createTestingModule,
  getTestLinkedSchema,
} from 'src/features/draft/commands/handlers/__tests__/utils';
import { RenameSchemaCommand } from 'src/features/draft/commands/impl/transactional/rename-schema.command';
import { SystemTables } from 'src/features/share/system-tables.consts';

describe('RenameSchemaHandler', () => {
  const nextTableId = 'nextTableId';
  let kit: DraftTestKit;

  it('should rename the schema if conditions are met', async () => {
    const { draftRevisionId, tableId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new RenameSchemaCommand({
      revisionId: draftRevisionId,
      tableId,
      nextTableId,
    });

    const result = await runTransaction(command);
    expect(result).toBe(true);

    const oldSchemaRow = await kit.prismaService.row.findFirst({
      where: {
        id: tableId,
        tables: {
          some: {
            id: SystemTables.Schema,
            revisions: {
              some: {
                id: draftRevisionId,
              },
            },
          },
        },
      },
    });
    expect(oldSchemaRow).toBeNull();

    const newSchemaRow = await kit.prismaService.row.findFirst({
      where: {
        id: nextTableId,
        tables: {
          some: {
            id: SystemTables.Schema,
            revisions: {
              some: {
                id: draftRevisionId,
              },
            },
          },
        },
      },
    });
    expect(newSchemaRow).not.toBeNull();
  });

  it('should update the linked table', async () => {
    const ids = await prepareProject(kit.prismaService, {
      createLinkedTable: true,
    });
    const { draftRevisionId, tableId, linkedTable } = ids;

    const command = new RenameSchemaCommand({
      revisionId: draftRevisionId,
      tableId,
      nextTableId,
    });

    const result = await runTransaction(command);
    expect(result).toBe(true);

    const schemaRow = await kit.prismaService.row.findFirstOrThrow({
      where: {
        id: linkedTable?.tableId,
        tables: {
          some: {
            id: SystemTables.Schema,
            revisions: {
              some: {
                id: draftRevisionId,
              },
            },
          },
        },
      },
    });

    expect(schemaRow.data).toStrictEqual(getTestLinkedSchema(nextTableId));
  });

  function runTransaction(command: RenameSchemaCommand): Promise<boolean> {
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
