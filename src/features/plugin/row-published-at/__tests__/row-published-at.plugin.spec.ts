import { nanoid } from 'nanoid';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import { getObjectSchema, getRefSchema } from '@revisium/schema-toolkit/mocks';
import { createJsonValueStore } from '@revisium/schema-toolkit/lib';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { RowPublishedAtPlugin } from '../row-published-at.plugin';
import {
  createRowMetadataPluginTestKit,
  givenRowMetadataPluginRow,
  givenRowMetadataPluginTable,
} from 'src/features/plugin/__tests__/row-metadata-plugin.spec-helper';

describe('row-published-at.plugin', () => {
  describe('afterCreateRow', () => {
    it('should not save row-published-at', async () => {
      const scenario = await givenRowMetadataPluginTable({
        prismaService: kit.prismaService,
        fieldName: 'customPublishedAt',
        schemaRef: SystemSchemaIds.RowPublishedAt,
      });
      const data = { customPublishedAt: '2025-05-22T05:59:51.079Z' };

      const result = (await kit.pluginService.afterCreateRow({
        revisionId: scenario.draftRevisionId,
        tableId: scenario.table.tableId,
        rowId: nanoid(),
        data,
      })) as typeof data;

      expect(result.customPublishedAt).toBe('');
    });
  });

  describe('afterUpdateRow', () => {
    it('should not save row-published-at', async () => {
      const scenario = await givenRowMetadataPluginTable({
        prismaService: kit.prismaService,
        fieldName: 'customPublishedAt',
        schemaRef: SystemSchemaIds.RowPublishedAt,
      });
      const previousData = { customPublishedAt: '' };
      const data = { customPublishedAt: '2025-05-22T05:59:51.079Z' };
      const { rowDraft } = await givenRowMetadataPluginRow({
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

      expect(result.customPublishedAt).toBe('');
    });
  });

  describe('computeRows', () => {
    it('should compute rows', async () => {
      const scenario = await givenRowMetadataPluginTable({
        prismaService: kit.prismaService,
        fieldName: 'customPublishedAt',
        schemaRef: SystemSchemaIds.RowPublishedAt,
      });
      const data = { customPublishedAt: '' };
      const { rowDraft } = await givenRowMetadataPluginRow({
        prismaService: kit.prismaService,
        scenario,
        data,
      });

      await kit.pluginService.computeRows({
        revisionId: scenario.draftRevisionId,
        tableId: scenario.table.tableId,
        rows: [rowDraft],
      });

      expect((rowDraft.data as typeof data).customPublishedAt).toBe(
        rowDraft.publishedAt.toISOString(),
      );
    });

    it('should not compute rows for system table', async () => {
      const scenario = await givenRowMetadataPluginTable({
        prismaService: kit.prismaService,
        fieldName: 'customPublishedAt',
        schemaRef: SystemSchemaIds.RowPublishedAt,
      });
      const data = { customPublishedAt: '' };
      const { rowDraft } = await givenRowMetadataPluginRow({
        prismaService: kit.prismaService,
        scenario,
        data,
      });

      await kit.pluginService.computeRows({
        revisionId: scenario.draftRevisionId,
        tableId: SystemTables.Schema,
        rows: [rowDraft],
      });

      expect((rowDraft.data as typeof data).customPublishedAt).toBe('');
    });
  });

  describe('afterMigrateRows', () => {
    it('should clear row-published-at during migration', async () => {
      const scenario = await givenRowMetadataPluginTable({
        prismaService: kit.prismaService,
        fieldName: 'customPublishedAt',
        schemaRef: SystemSchemaIds.RowPublishedAt,
      });
      const data = {
        customPublishedAt: '2025-05-22T05:59:51.079Z',
      } as const;
      const { rowDraft } = await givenRowMetadataPluginRow({
        prismaService: kit.prismaService,
        scenario,
        data,
      });

      await kit.pluginService.afterMigrateRows({
        revisionId: scenario.draftRevisionId,
        tableId: scenario.table.tableId,
        rows: [rowDraft],
      });

      expect((rowDraft.data as typeof data).customPublishedAt).toBe('');
    });
  });

  describe('getPublishedAt', () => {
    it('should return undefined when no publishedAt fields exist', async () => {
      const schema = getObjectSchema({});
      const valueStore = createJsonValueStore(
        jsonSchemaStore.create(schema),
        '',
        {},
      );

      const result = rowPublishedAtPlugin.getPublishedAt(valueStore);
      expect(result).toBeUndefined();
    });

    it('should return publishedAt value when it exists', async () => {
      const schema = getObjectSchema({
        customPublishedAt: getRefSchema(SystemSchemaIds.RowPublishedAt),
      });
      const publishedAt = '2025-05-22T05:59:51.079Z';
      const valueStore = createJsonValueStore(
        jsonSchemaStore.create(schema),
        '',
        { customPublishedAt: publishedAt },
      );

      const result = rowPublishedAtPlugin.getPublishedAt(valueStore);
      expect(result).toBe(publishedAt);
    });

    it('should return first publishedAt value when multiple exist', async () => {
      const schema = getObjectSchema({
        customPublishedAt1: getRefSchema(SystemSchemaIds.RowPublishedAt),
        customPublishedAt2: getRefSchema(SystemSchemaIds.RowPublishedAt),
      });
      const firstPublishedAt = '2025-05-22T05:59:51.079Z';
      const valueStore = createJsonValueStore(
        jsonSchemaStore.create(schema),
        '',
        {
          customPublishedAt1: firstPublishedAt,
          customPublishedAt2: '2025-05-23T05:59:51.079Z',
        },
      );

      const result = rowPublishedAtPlugin.getPublishedAt(valueStore);
      expect(result).toBe(firstPublishedAt);
    });

    it('should return undefined when publishedAt field is null', async () => {
      const schema = getObjectSchema({
        customPublishedAt: getRefSchema(SystemSchemaIds.RowPublishedAt),
      });
      const valueStore = createJsonValueStore(
        jsonSchemaStore.create(schema),
        '',
        { customPublishedAt: null },
      );

      const result = rowPublishedAtPlugin.getPublishedAt(valueStore);
      expect(result).toBeUndefined();
    });
  });

  let kit: DraftTestKit;
  let jsonSchemaStore: JsonSchemaStoreService;
  let rowPublishedAtPlugin: RowPublishedAtPlugin;

  beforeAll(async () => {
    kit = await createRowMetadataPluginTestKit();
    jsonSchemaStore = kit.module.get(JsonSchemaStoreService);
    rowPublishedAtPlugin = kit.module.get(RowPublishedAtPlugin);
  });

  afterAll(async () => {
    await kit.close();
  });
});
