import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { givenDraftProject } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import {
  createTestingModule,
  invalidTestSchema,
  testSchema,
  testSchemaString,
} from 'src/features/draft/commands/handlers/__tests__/utils';
import { UpdateSchemaCommand } from 'src/features/draft/commands/impl/transactional/update-schema.command';
import { SystemTables } from 'src/features/share/system-tables.consts';
import {
  JsonPatchAdd,
  JsonPatchReplace,
  JsonSchema,
} from '@revisium/schema-toolkit/types';

describe('UpdateSchemaHandler', () => {
  let kit: DraftTestKit;

  it('should throw an error if the data is invalid', async () => {
    const { draftRevisionId, tableId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new UpdateSchemaCommand({
      revisionId: draftRevisionId,
      tableId,
      schema: {} as JsonSchema,
      patches: [
        {
          op: 'replace',
          path: '',
          value: testSchemaString,
        } as JsonPatchReplace,
        { op: 'add', path: '', value: testSchema } as JsonPatchAdd,
      ],
    });

    await expect(runTransaction(command)).rejects.toThrow('data is not valid');
  });

  it('should throw an error if the patches are invalid', async () => {
    const { draftRevisionId, tableId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new UpdateSchemaCommand({
      revisionId: draftRevisionId,
      tableId,
      schema: testSchema,
      patches: [
        {
          op: 'replace',
          path: '',
          value: testSchemaString,
        } as JsonPatchReplace,
        { op: 'add', path: '' } as JsonPatchAdd,
      ],
    });

    await expect(runTransaction(command)).rejects.toThrow(
      'patches is not valid',
    );
  });

  it('should throw an error if there is invalid field name', async () => {
    const { draftRevisionId, tableId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new UpdateSchemaCommand({
      revisionId: draftRevisionId,
      tableId,
      schema: testSchemaString,
      patches: [
        {
          op: 'replace',
          path: '',
          value: testSchemaString,
        } as JsonPatchReplace,
        {
          op: 'replace',
          path: '',
          value: invalidTestSchema,
        } as JsonPatchReplace,
        {
          op: 'replace',
          path: '',
          value: testSchemaString,
        } as JsonPatchReplace,
      ],
    });

    await expect(runTransaction(command)).rejects.toThrow(
      'Invalid field names: 123, $ver. It must contain between',
    );
  });

  it('should update the schema if conditions are met', async () => {
    const { draftRevisionId, tableId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new UpdateSchemaCommand({
      revisionId: draftRevisionId,
      tableId,
      schema: testSchemaString,
      patches: [
        {
          op: 'replace',
          path: '',
          value: testSchemaString,
        } as JsonPatchReplace,
        {
          op: 'replace',
          path: '',
          value: testSchema,
        } as JsonPatchReplace,
        {
          op: 'replace',
          path: '',
          value: testSchemaString,
        } as JsonPatchReplace,
      ],
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
    expect(schemaRow.data).toStrictEqual(testSchemaString);
  });

  function runTransaction(command: UpdateSchemaCommand): Promise<boolean> {
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
