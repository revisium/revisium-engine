import hash from 'object-hash';
import { nanoid } from 'nanoid';
import {
  createExpressFile,
  createExpressImageFile,
} from 'src/__tests__/utils/file';
import { createEmptyFile } from 'src/__tests__/utils/prepareProject';
import { FileStatus } from 'src/features/plugin/file/consts';
import { FilePlugin } from 'src/features/plugin/file/file.plugin';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { createJsonValueStore } from '@revisium/schema-toolkit/lib';
import { JsonValue } from '@revisium/schema-toolkit/types';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import {
  createFilePluginTestKit,
  createPreviousFile,
  givenFilePluginRow,
  givenFilePluginScenario,
} from './file-plugin.spec-helper';

describe('file.plugin', () => {
  describe('afterCreateRow', () => {
    it('should update files', async () => {
      const { draftRevisionId, table } = await givenFilePluginScenario(
        kit.prismaService,
        jsonSchemaStore,
      );
      const emptyFile = createEmptyFile();
      const data = {
        file: emptyFile,
        files: [emptyFile, emptyFile, emptyFile],
      };

      const result = (await kit.pluginService.afterCreateRow({
        revisionId: draftRevisionId,
        tableId: table.tableId,
        rowId: nanoid(),
        data,
      })) as typeof data;

      expect(result.file.status).toBe(FileStatus.ready);
      expect(result.file.fileId).toBeTruthy();

      for (const file of result.files) {
        expect(file.status).toBe(FileStatus.ready);
        expect(file.fileId).toBeTruthy();
      }
    });

    it('should throw error if the data is invalid', async () => {
      const { draftRevisionId, table } = await givenFilePluginScenario(
        kit.prismaService,
        jsonSchemaStore,
      );
      const emptyFile = createEmptyFile();

      const data = {
        file: emptyFile,
        files: [
          emptyFile,
          {
            ...emptyFile,
            size: 1,
          },
          emptyFile,
        ],
      };

      await expect(
        kit.pluginService.afterCreateRow({
          revisionId: draftRevisionId,
          tableId: table.tableId,
          rowId: nanoid(),
          data,
        }),
      ).rejects.toThrow('size must have default value = 0');
    });
  });

  describe('afterUpdateRow', () => {
    it('should update files', async () => {
      const scenario = await givenFilePluginScenario(
        kit.prismaService,
        jsonSchemaStore,
      );

      const previousData = {
        file: createPreviousFile(),
        files: [createPreviousFile()],
      };

      const data = {
        file: { ...previousData.file, url: 'url', fileName: 'filename' },
        files: [...previousData.files, createEmptyFile(), createEmptyFile()],
      };

      const { rowDraft } = await givenFilePluginRow({
        prismaService: kit.prismaService,
        scenario,
        data: previousData,
      });

      const result = (await kit.pluginService.afterUpdateRow({
        revisionId: scenario.draftRevisionId,
        tableId: scenario.table.tableId,
        rowId: rowDraft.id,
        data,
      })) as typeof data;

      expect(result.file.status).toBe(FileStatus.ready);
      expect(result.file.fileId).toBeTruthy();
      expect(result.file.url).toBe('');
      expect(result.file.fileName).toBe('filename');

      for (const file of result.files) {
        expect(file.status).toBe(FileStatus.ready);
        expect(file.fileId).toBeTruthy();
      }
    });

    it('should throw error if the data is invalid', async () => {
      const scenario = await givenFilePluginScenario(
        kit.prismaService,
        jsonSchemaStore,
      );

      const previousData = {
        file: createPreviousFile(),
        files: [createPreviousFile()],
      };

      const data = {
        file: { ...previousData.file, size: 100 },
        files: [...previousData.files, createEmptyFile(), createEmptyFile()],
      };

      const { rowDraft } = await givenFilePluginRow({
        prismaService: kit.prismaService,
        scenario,
        data: previousData,
      });

      await expect(
        kit.pluginService.afterUpdateRow({
          revisionId: scenario.draftRevisionId,
          tableId: scenario.table.tableId,
          rowId: rowDraft.id,
          data,
        }),
      ).rejects.toThrow('size must have value = 0');
    });

    it('should throw error if the file does not exist', async () => {
      const scenario = await givenFilePluginScenario(
        kit.prismaService,
        jsonSchemaStore,
      );

      const previousData = {
        file: createPreviousFile(),
        files: [],
      };

      const data = {
        file: previousData.file,
        files: [createPreviousFile()],
      } as const;

      const { rowDraft } = await givenFilePluginRow({
        prismaService: kit.prismaService,
        scenario,
        data: previousData,
      });

      await expect(
        kit.pluginService.afterUpdateRow({
          revisionId: scenario.draftRevisionId,
          tableId: scenario.table.tableId,
          rowId: rowDraft.id,
          data,
        }),
      ).rejects.toThrow(`File ${data.files[0].fileId} does not exist`);
    });
  });

  describe('computeRows', () => {
    it('should compute rows', async () => {
      const scenario = await givenFilePluginScenario(
        kit.prismaService,
        jsonSchemaStore,
      );

      const data = {
        file: {
          ...createPreviousFile(),
          status: FileStatus.uploaded,
          url: 'url',
        },
        files: [
          {
            ...createPreviousFile(),
            status: FileStatus.uploaded,
          },
          createPreviousFile(),
          createEmptyFile(),
        ],
      };

      const { rowDraft } = await givenFilePluginRow({
        prismaService: kit.prismaService,
        scenario,
        data: data,
      });

      await kit.pluginService.computeRows({
        revisionId: scenario.draftRevisionId,
        tableId: scenario.table.tableId,
        rows: [rowDraft],
      });

      const result = rowDraft.data as typeof data;

      expect(result.file.url).toBeTruthy();
      expect((result.files[0] as typeof result.file).url).toBeTruthy();
      expect((result.files[1] as typeof result.file).url).toBe('');
      expect((result.files[2] as typeof result.file).url).toBe('');
    });

    it('should not compute rows for system table', async () => {
      const scenario = await givenFilePluginScenario(
        kit.prismaService,
        jsonSchemaStore,
      );

      const data = {
        file: {
          ...createPreviousFile(),
          status: FileStatus.uploaded,
          url: 'test',
        },
        files: [],
      };

      const { rowDraft } = await givenFilePluginRow({
        prismaService: kit.prismaService,
        scenario,
        data: data,
      });

      await kit.pluginService.computeRows({
        revisionId: scenario.draftRevisionId,
        tableId: SystemTables.Schema,
        rows: [rowDraft],
      });

      const result = rowDraft.data as typeof data;

      expect(result.file.url).toBe('test');
    });
  });

  describe('afterMigrateRows', () => {
    it('should migrate files', async () => {
      const scenario = await givenFilePluginScenario(
        kit.prismaService,
        jsonSchemaStore,
      );

      const data = {
        file: createPreviousFile(),
        files: [createPreviousFile(), createEmptyFile(), createEmptyFile()],
      } as const;

      const { rowDraft } = await givenFilePluginRow({
        prismaService: kit.prismaService,
        scenario,
        data: data,
      });

      await kit.pluginService.afterMigrateRows({
        revisionId: scenario.draftRevisionId,
        tableId: scenario.table.tableId,
        rows: [rowDraft],
      });

      const result = rowDraft.data as unknown as typeof data;

      expect(result.files[1].status).toBe(FileStatus.ready);
      expect(result.files[1].fileId).toBeTruthy();
      expect(result.files[2].status).toBe(FileStatus.ready);
      expect(result.files[2].fileId).toBeTruthy();
    });
  });

  describe('uploadFile', () => {
    it('should upload file', async () => {
      const scenario = await givenFilePluginScenario(
        kit.prismaService,
        jsonSchemaStore,
      );

      const previousData = {
        file: createPreviousFile(),
        files: [],
      };

      const data = {
        file: { ...previousData.file, url: 'url', fileName: 'filename' },
        files: [],
      };

      const { rowDraft } = await givenFilePluginRow({
        prismaService: kit.prismaService,
        scenario,
        data: previousData,
      });

      const valueStore = createJsonValueStore(
        scenario.schemaStore,
        '',
        rowDraft.data as JsonValue,
      );
      const file = createExpressFile();

      await filePlugin.uploadFile({
        valueStore,
        fileId: data.file.fileId,
        file,
      });

      const result = valueStore.getPlainValue() as typeof data;

      expect(result.file.status).toBe(FileStatus.uploaded);
      expect(result.file.fileId).toBe(data.file.fileId);
      expect(result.file.fileName).toBe(file.originalname);
      expect(result.file.mimeType).toBe(file.mimetype);
      expect(result.file.extension).toBe('txt');
      expect(result.file.hash).toBe(hash(file.buffer));
      expect(result.file.url).toBe('');
      expect(result.file.size).toBe(file.size);
      expect(result.file.width).toBe(0);
      expect(result.file.height).toBe(0);
    });

    it('should upload image file', async () => {
      const scenario = await givenFilePluginScenario(
        kit.prismaService,
        jsonSchemaStore,
      );

      const previousData = {
        file: createPreviousFile(),
        files: [],
      };

      const data = {
        file: { ...previousData.file, url: 'url', fileName: 'filename' },
        files: [],
      };

      const { rowDraft } = await givenFilePluginRow({
        prismaService: kit.prismaService,
        scenario,
        data: previousData,
      });

      const valueStore = createJsonValueStore(
        scenario.schemaStore,
        '',
        rowDraft.data as JsonValue,
      );
      const file = createExpressImageFile();

      await filePlugin.uploadFile({
        valueStore,
        fileId: data.file.fileId,
        file,
      });

      const result = valueStore.getPlainValue() as typeof data;

      expect(result.file.status).toBe(FileStatus.uploaded);
      expect(result.file.fileId).toBe(data.file.fileId);
      expect(result.file.fileName).toBe(file.originalname);
      expect(result.file.mimeType).toBe(file.mimetype);
      expect(result.file.extension).toBe('png');
      expect(result.file.hash).toBe(hash(file.buffer));
      expect(result.file.url).toBe('');
      expect(result.file.size).toBe(file.size);
      expect(result.file.width).toBe(420);
      expect(result.file.height).toBe(420);
    });

    it('should throw error if file not found', async () => {
      const scenario = await givenFilePluginScenario(
        kit.prismaService,
        jsonSchemaStore,
      );

      const previousData = {
        file: createPreviousFile(),
        files: [],
      };

      const { rowDraft } = await givenFilePluginRow({
        prismaService: kit.prismaService,
        scenario,
        data: previousData,
      });

      await expect(
        filePlugin.uploadFile({
          valueStore: createJsonValueStore(
            scenario.schemaStore,
            '',
            rowDraft.data as JsonValue,
          ),
          fileId: 'unrealId',
          file: createExpressImageFile(),
        }),
      ).rejects.toThrow(`Invalid count of files`);
    });

    it('should throw error if there is same id', async () => {
      const scenario = await givenFilePluginScenario(
        kit.prismaService,
        jsonSchemaStore,
      );

      const file = createPreviousFile();

      const previousData = {
        file: file,
        files: [file],
      };

      const { rowDraft } = await givenFilePluginRow({
        prismaService: kit.prismaService,
        scenario,
        data: previousData,
      });

      await expect(
        filePlugin.uploadFile({
          valueStore: createJsonValueStore(
            scenario.schemaStore,
            '',
            rowDraft.data as JsonValue,
          ),
          fileId: file.fileId,
          file: createExpressImageFile(),
        }),
      ).rejects.toThrow(`Invalid count of files`);
    });
  });

  let kit: DraftTestKit;
  let filePlugin: FilePlugin;
  let jsonSchemaStore: JsonSchemaStoreService;

  beforeAll(async () => {
    kit = await createFilePluginTestKit();
    filePlugin = kit.module.get(FilePlugin);
    jsonSchemaStore = kit.module.get(JsonSchemaStoreService);
  });

  afterAll(async () => {
    await kit.close();
  });
});
