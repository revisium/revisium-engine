import { nanoid } from 'nanoid';
import hash from 'object-hash';
import { createExpressImageFile } from 'src/__tests__/utils/file';
import {
  prepareProject,
  prepareRow,
  prepareTableWithSchema,
} from 'src/__tests__/utils/prepareProject';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import {
  getArraySchema,
  getObjectSchema,
  getRefSchema,
} from '@revisium/schema-toolkit/mocks';
import { createTestingModule } from 'src/features/draft/commands/handlers/__tests__/utils';
import {
  UploadFileCommand,
  UploadFileCommandReturnType,
} from 'src/features/draft/commands/impl/update-file.command';
import { FileStatus } from 'src/features/plugin/file/consts';
import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';

describe('UploadFileHandler', () => {
  let kit: DraftTestKit;

  it('should throw error when row not found', async () => {
    const ids = await prepareProject(kit.prismaService);
    const {
      headRevisionId,
      draftRevisionId,
      schemaTableVersionId,
      migrationTableVersionId,
    } = ids;

    const table = await prepareTableWithSchema({
      prismaService: kit.prismaService,
      headRevisionId,
      draftRevisionId,
      schemaTableVersionId,
      migrationTableVersionId,
      schema: getObjectSchema({
        file: getRefSchema(SystemSchemaIds.File),
      }),
    });

    const command = new UploadFileCommand({
      revisionId: draftRevisionId,
      tableId: table.tableId,
      rowId: 'non-existent-row',
      fileId: nanoid(),
      file: createExpressImageFile(),
    });

    await expect(runTransaction(command)).rejects.toThrow('Row not found');
  });

  it('should upload file', async () => {
    const ids = await prepareProject(kit.prismaService);
    const {
      headRevisionId,
      draftRevisionId,
      schemaTableVersionId,
      migrationTableVersionId,
    } = ids;

    const table = await prepareTableWithSchema({
      prismaService: kit.prismaService,
      headRevisionId,
      draftRevisionId,
      schemaTableVersionId,
      migrationTableVersionId,
      schema: getObjectSchema({
        file: getRefSchema(SystemSchemaIds.File),
        files: getArraySchema(getRefSchema(SystemSchemaIds.File)),
      }),
    });

    const file = {
      status: FileStatus.ready,
      fileId: nanoid(),
      url: '',
      fileName: '',
      hash: '',
      extension: '',
      mimeType: '',
      size: 0,
      width: 0,
      height: 0,
    };
    const data = {
      file,
      files: [],
    };

    const { rowDraft } = await prepareRow({
      prismaService: kit.prismaService,
      headTableVersionId: table.headTableVersionId,
      draftTableVersionId: table.draftTableVersionId,
      schema: table.schema,
      data: data,
      dataDraft: data,
    });

    const command = new UploadFileCommand({
      revisionId: draftRevisionId,
      tableId: table.tableId,
      rowId: rowDraft.id,
      fileId: file.fileId,
      file: createExpressImageFile(),
    });

    const result = await runTransaction(command);
    expect(result.rowVersionId).toBeTruthy();

    const row = await kit.rowApiService.getRow({
      revisionId: draftRevisionId,
      tableId: table.tableId,
      rowId: rowDraft.id,
    });

    expect(row).not.toBeNull();
    const fileHash = hash(command.data.file.buffer);
    expect((row?.data as typeof data).file).toStrictEqual({
      extension: 'png',
      fileId: data.file.fileId,
      fileName: 'logo.png',
      hash: fileHash,
      height: 420,
      mimeType: 'image/png',
      size: 10037,
      status: 'uploaded',
      url: `http://test-files/${fileHash}`,
      width: 420,
    });
  });

  function runTransaction(
    command: UploadFileCommand,
  ): Promise<UploadFileCommandReturnType> {
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
