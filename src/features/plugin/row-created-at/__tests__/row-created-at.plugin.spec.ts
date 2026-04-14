import { nanoid } from 'nanoid';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import { SystemTables } from 'src/features/share/system-tables.consts';
import {
  createRowMetadataPluginTestKit,
  givenRowMetadataPluginRow,
  givenRowMetadataPluginTable,
} from 'src/features/plugin/__tests__/row-metadata-plugin.spec-helper';

describe('row-created-at.plugin', () => {
  describe('afterCreateRow', () => {
    it('should not save row-created-at', async () => {
      const scenario = await givenRowMetadataPluginTable({
        prismaService: kit.prismaService,
        fieldName: 'customCreatedAt',
        schemaRef: SystemSchemaIds.RowCreatedAt,
      });
      const data = { customCreatedAt: '2025-05-22T05:59:51.079Z' };

      const result = (await kit.pluginService.afterCreateRow({
        revisionId: scenario.draftRevisionId,
        tableId: scenario.table.tableId,
        rowId: nanoid(),
        data,
      })) as typeof data;

      expect(result.customCreatedAt).toBe('');
    });
  });

  describe('afterUpdateRow', () => {
    it('should not save row-created-at', async () => {
      const scenario = await givenRowMetadataPluginTable({
        prismaService: kit.prismaService,
        fieldName: 'customCreatedAt',
        schemaRef: SystemSchemaIds.RowCreatedAt,
      });
      const previousData = { customCreatedAt: '' };
      const data = { customCreatedAt: '2025-05-22T05:59:51.079Z' };
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

      expect(result.customCreatedAt).toBe('');
    });
  });

  describe('computeRows', () => {
    it('should compute rows', async () => {
      const scenario = await givenRowMetadataPluginTable({
        prismaService: kit.prismaService,
        fieldName: 'customCreatedAt',
        schemaRef: SystemSchemaIds.RowCreatedAt,
      });
      const data = { customCreatedAt: '' };
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

      expect((rowDraft.data as typeof data).customCreatedAt).toBe(
        rowDraft.createdAt.toISOString(),
      );
    });

    it('should not compute rows for system table', async () => {
      const scenario = await givenRowMetadataPluginTable({
        prismaService: kit.prismaService,
        fieldName: 'customCreatedAt',
        schemaRef: SystemSchemaIds.RowCreatedAt,
      });
      const data = { customCreatedAt: '' };
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

      expect((rowDraft.data as typeof data).customCreatedAt).toBe('');
    });
  });

  describe('afterMigrateRows', () => {
    it('should clear row-created-at during migration', async () => {
      const scenario = await givenRowMetadataPluginTable({
        prismaService: kit.prismaService,
        fieldName: 'customCreatedAt',
        schemaRef: SystemSchemaIds.RowCreatedAt,
      });
      const data = {
        customCreatedAt: '2025-05-22T05:59:51.079Z',
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

      expect((rowDraft.data as typeof data).customCreatedAt).toBe('');
    });
  });

  let kit: DraftTestKit;

  beforeAll(async () => {
    kit = await createRowMetadataPluginTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });
});
