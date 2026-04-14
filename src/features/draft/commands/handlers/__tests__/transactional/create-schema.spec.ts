import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { givenDraftProject } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import {
  createTestingModule,
  invalidTestSchema,
  testSchema,
} from 'src/features/draft/commands/handlers/__tests__/utils';
import { CreateSchemaCommand } from 'src/features/draft/commands/impl/transactional/create-schema.command';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { JsonSchema } from '@revisium/schema-toolkit/types';

describe('CreateSchemaHandler', () => {
  let kit: DraftTestKit;

  it('should throw an error if the data is invalid', async () => {
    const { draftRevisionId } = await givenDraftProject(kit.prismaService);

    const tableId = 'newTableId';
    const command = new CreateSchemaCommand({
      revisionId: draftRevisionId,
      tableId,
      data: {} as JsonSchema,
    });

    await expect(runTransaction(command)).rejects.toThrow('data is not valid');
  });

  it('should throw an error if there is invalid field name', async () => {
    const { draftRevisionId } = await givenDraftProject(kit.prismaService);

    const tableId = 'newTableId';
    const command = new CreateSchemaCommand({
      revisionId: draftRevisionId,
      tableId,
      data: invalidTestSchema,
    });

    await expect(runTransaction(command)).rejects.toThrow(
      'Invalid field names: 123, $ver. It must contain between',
    );
  });

  it('should create a new schema if conditions are met', async () => {
    const { draftRevisionId } = await givenDraftProject(kit.prismaService);
    const tableId = 'newTableId';

    const command = new CreateSchemaCommand({
      revisionId: draftRevisionId,
      tableId,
      data: testSchema,
    });

    const result = await runTransaction(command);
    expect(result).toBe(true);

    const schemaRow = await kit.prismaService.row.findFirstOrThrow({
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
    expect(schemaRow.data).toStrictEqual(testSchema);
  });

  function runTransaction(command: CreateSchemaCommand): Promise<boolean> {
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
