import { Prisma } from 'src/__generated__/client';
import { nanoid } from 'nanoid';
import { createEmptyFile } from 'src/__tests__/utils/prepareProject';
import { FileStatus } from 'src/features/plugin/file/consts';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import {
  createValidFileData,
  createReadyFileData,
  createTestData,
  runValidationTest,
  validationTestScenarios,
  uploadedFileConsistencyScenarios,
  FileTestData,
} from './file-restore.test-utils';
import {
  createFilePluginTestKit,
  givenFilePluginRow,
  givenFilePluginScenario,
} from './file-plugin.spec-helper';

interface FilePluginResult {
  file: FileTestData;
  files: FileTestData[];
}

describe('file.plugin restore mode', () => {
  let kit: DraftTestKit;
  let jsonSchemaStore: JsonSchemaStoreService;

  describe('afterCreateRow with isRestore=true', () => {
    it('should validate and accept valid restore data', async () => {
      const { draftRevisionId, table } = await givenFilePluginScenario(
        kit.prismaService,
        jsonSchemaStore,
      );
      const validFileData = createValidFileData();
      const data = createTestData(validFileData);

      const result = (await kit.pluginService.afterCreateRow({
        revisionId: draftRevisionId,
        tableId: table.tableId,
        rowId: nanoid(),
        data: data as unknown as Prisma.InputJsonValue,
        isRestore: true,
      })) as unknown as FilePluginResult;

      expect(result.file.status).toBe(FileStatus.uploaded);
      expect(result.file.fileId).toBe(validFileData.fileId);
      expect(result.file.hash).toBe(validFileData.hash);
      expect(result.file.url).toBe('');
    });

    it('should validate and accept ready status files', async () => {
      const { draftRevisionId, table } = await givenFilePluginScenario(
        kit.prismaService,
        jsonSchemaStore,
      );
      const readyFileData = createReadyFileData();
      const data = createTestData(readyFileData);

      const result = (await kit.pluginService.afterCreateRow({
        revisionId: draftRevisionId,
        tableId: table.tableId,
        rowId: nanoid(),
        data: data as unknown as Prisma.InputJsonValue,
        isRestore: true,
      })) as unknown as FilePluginResult;

      expect(result.file.status).toBe(FileStatus.ready);
      expect(result.file.fileId).toBe(readyFileData.fileId);
      expect(result.file.url).toBe('');
    });

    it('should throw error for invalid fileId format', async () => {
      const { draftRevisionId, table } = await givenFilePluginScenario(
        kit.prismaService,
        jsonSchemaStore,
      );
      const invalidFileData = createReadyFileData({ fileId: 'invalid-id' });
      const data = createTestData(invalidFileData);

      await expect(
        kit.pluginService.afterCreateRow({
          revisionId: draftRevisionId,
          tableId: table.tableId,
          rowId: nanoid(),
          data: data as unknown as Prisma.InputJsonValue,
          isRestore: true,
        }),
      ).rejects.toThrow(
        'Invalid fileId format - must be nanoid (21 URL-safe characters)',
      );
    });

    it('should throw error for duplicate fileIds', async () => {
      const { draftRevisionId, table } = await givenFilePluginScenario(
        kit.prismaService,
        jsonSchemaStore,
      );
      const duplicateFileId = nanoid();
      const fileData = createReadyFileData({ fileId: duplicateFileId });
      const data = createTestData(fileData, [fileData]);

      await expect(
        kit.pluginService.afterCreateRow({
          revisionId: draftRevisionId,
          tableId: table.tableId,
          rowId: nanoid(),
          data: data as unknown as Prisma.InputJsonValue,
          isRestore: true,
        }),
      ).rejects.toThrow(
        `Duplicate fileId found: ${duplicateFileId}. FileId must be unique within a row`,
      );
    });

    it('should throw error for uploaded file without required fields', async () => {
      const { draftRevisionId, table } = await givenFilePluginScenario(
        kit.prismaService,
        jsonSchemaStore,
      );
      const incompleteFileData = createValidFileData({
        hash: '',
        mimeType: '',
        size: 0,
      });
      const data = createTestData(incompleteFileData);

      await expect(
        kit.pluginService.afterCreateRow({
          revisionId: draftRevisionId,
          tableId: table.tableId,
          rowId: nanoid(),
          data: data as unknown as Prisma.InputJsonValue,
          isRestore: true,
        }),
      ).rejects.toThrow('hash is required when status is uploaded');
    });

    it('should throw error for invalid hash format', async () => {
      const { draftRevisionId, table } = await givenFilePluginScenario(
        kit.prismaService,
        jsonSchemaStore,
      );
      const invalidHashData = createValidFileData({
        hash: 'invalid-hash-format',
      });
      const data = createTestData(invalidHashData);

      await expect(
        kit.pluginService.afterCreateRow({
          revisionId: draftRevisionId,
          tableId: table.tableId,
          rowId: nanoid(),
          data: data as unknown as Prisma.InputJsonValue,
          isRestore: true,
        }),
      ).rejects.toThrow(
        'Invalid hash format - must be MD5, SHA-1, SHA-256, or SHA-512',
      );
    });

    it('should throw error for invalid file dimensions', async () => {
      const { draftRevisionId, table } = await givenFilePluginScenario(
        kit.prismaService,
        jsonSchemaStore,
      );
      const invalidDimensionsData = createValidFileData({
        width: -100,
      });
      const data = createTestData(invalidDimensionsData);

      await expect(
        kit.pluginService.afterCreateRow({
          revisionId: draftRevisionId,
          tableId: table.tableId,
          rowId: nanoid(),
          data: data as unknown as Prisma.InputJsonValue,
          isRestore: true,
        }),
      ).rejects.toThrow('width must be a non-negative integer');
    });

    it('should throw error for non-image file with dimensions', async () => {
      const { draftRevisionId, table } = await givenFilePluginScenario(
        kit.prismaService,
        jsonSchemaStore,
      );
      const nonImageWithDimensions = createValidFileData({
        mimeType: 'application/pdf',
        extension: 'pdf',
        width: 100,
        height: 100,
      });
      const data = createTestData(nonImageWithDimensions);

      await expect(
        kit.pluginService.afterCreateRow({
          revisionId: draftRevisionId,
          tableId: table.tableId,
          rowId: nanoid(),
          data: data as unknown as Prisma.InputJsonValue,
          isRestore: true,
        }),
      ).rejects.toThrow('width and height must be 0 for non-image files');
    });
  });

  describe('afterUpdateRow with isRestore=true', () => {
    it('should validate restore data for update', async () => {
      const scenario = await givenFilePluginScenario(
        kit.prismaService,
        jsonSchemaStore,
      );
      const validFileData = createValidFileData();
      const data = createTestData(validFileData);

      const { rowDraft } = await givenFilePluginRow({
        prismaService: kit.prismaService,
        scenario,
        data: { file: createEmptyFile(), files: [] },
        draftData: { file: createEmptyFile(), files: [] },
      });

      const result = (await kit.pluginService.afterUpdateRow({
        revisionId: scenario.draftRevisionId,
        tableId: scenario.table.tableId,
        rowId: rowDraft.id,
        data: data as unknown as Prisma.InputJsonValue,
        isRestore: true,
      })) as unknown as FilePluginResult;

      expect(result.file.status).toBe(FileStatus.uploaded);
      expect(result.file.fileId).toBe(validFileData.fileId);
      expect(result.file.url).toBe('');
    });
  });

  describe('validation edge cases', () => {
    const testValidation = async (
      data: Prisma.InputJsonValue,
      isRestore: boolean,
    ) => {
      const { draftRevisionId, table } = await givenFilePluginScenario(
        kit.prismaService,
        jsonSchemaStore,
      );
      return kit.pluginService.afterCreateRow({
        revisionId: draftRevisionId,
        tableId: table.tableId,
        rowId: nanoid(),
        data,
        isRestore,
      });
    };

    // Test all validation scenarios using the utility function
    validationTestScenarios.forEach((scenario) => {
      it(`should throw error for ${scenario.name}`, async () => {
        await runValidationTest(testValidation, scenario);
      });
    });

    // Test uploaded file consistency scenarios
    uploadedFileConsistencyScenarios.forEach((scenario) => {
      it(`should throw error when ${scenario.name}`, async () => {
        await runValidationTest(
          testValidation,
          scenario,
          createValidFileData(),
        );
      });
    });
  });

  describe('valid MIME types', () => {
    const validMimeTypes = [
      // Test MIME types with special characters: "+", ".", "-"
      { mimeType: 'image/svg+xml', extension: 'svg', fileName: 'image.svg' },
      {
        mimeType: 'application/vnd.ms-excel',
        extension: 'xls',
        fileName: 'spreadsheet.xls',
        width: 0,
        height: 0,
      },
      {
        mimeType: 'font/woff2',
        extension: 'woff2',
        fileName: 'font.woff2',
        width: 0,
        height: 0,
      },
    ];

    validMimeTypes.forEach(
      ({ mimeType, extension, fileName, width, height }) => {
        it(`should accept ${mimeType} MIME type`, async () => {
          const { draftRevisionId, table } = await givenFilePluginScenario(
            kit.prismaService,
            jsonSchemaStore,
          );
          const validFileData = createValidFileData({
            mimeType,
            extension,
            fileName,
            ...(width !== undefined && { width }),
            ...(height !== undefined && { height }),
          });
          const data = createTestData(validFileData);

          const result = (await kit.pluginService.afterCreateRow({
            revisionId: draftRevisionId,
            tableId: table.tableId,
            rowId: nanoid(),
            data: data as unknown as Prisma.InputJsonValue,
            isRestore: true,
          })) as unknown as FilePluginResult;

          expect(result.file.mimeType).toBe(mimeType);
          expect(result.file.status).toBe(FileStatus.uploaded);
        });
      },
    );
  });

  beforeAll(async () => {
    kit = await createFilePluginTestKit();
    jsonSchemaStore = kit.module.get(JsonSchemaStoreService);
  });

  afterAll(async () => {
    await kit.close();
  });
});
