import { Row } from 'src/__generated__/client';
import { PluginListService } from 'src/features/plugin/plugin.list.service';
import { PluginService } from 'src/features/plugin/plugin.service';
import {
  ComputeRowsResult,
  FormulaFieldError,
  RowWithTableId,
} from 'src/features/plugin/types';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { FormulaPlugin } from 'src/features/plugin/formula/formula.plugin';
import { RowIdPlugin } from 'src/features/plugin/row-id/row-id.plugin';
import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import {
  getObjectSchema,
  getRefSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';

describe('PluginService', () => {
  describe('groupRowsByTable', () => {
    it('should return empty map for empty input', () => {
      const result = pluginService.groupRowsByTable([]);

      expect(result.size).toBe(0);
    });

    it('should group rows by tableId', () => {
      const row1 = createRow('v1');
      const row2 = createRow('v2');
      const row3 = createRow('v3');

      const items: RowWithTableId[] = [
        { tableId: 'table-a', row: row1 },
        { tableId: 'table-b', row: row2 },
        { tableId: 'table-a', row: row3 },
      ];

      const result = pluginService.groupRowsByTable(items);

      expect(result.size).toBe(2);
      expect(result.get('table-a')).toEqual([row1, row3]);
      expect(result.get('table-b')).toEqual([row2]);
    });

    it('should deduplicate rows by versionId within same table', () => {
      const row = createRow('v1');

      const result = pluginService.groupRowsByTable([
        { tableId: 'table-a', row },
        { tableId: 'table-a', row },
        { tableId: 'table-a', row },
      ]);

      expect(result.get('table-a')).toEqual([row]);
    });

    it('should keep different rows from same table', () => {
      const row1 = createRow('v1');
      const row2 = createRow('v2');

      const result = pluginService.groupRowsByTable([
        { tableId: 'table-a', row: row1 },
        { tableId: 'table-a', row: row2 },
      ]);

      expect(result.get('table-a')).toEqual([row1, row2]);
    });

    it('should not deduplicate same versionId across different tables', () => {
      const row1 = createRow('v1');
      const row2 = createRow('v1');

      const result = pluginService.groupRowsByTable([
        { tableId: 'table-a', row: row1 },
        { tableId: 'table-b', row: row2 },
      ]);

      expect(result.get('table-a')).toEqual([row1]);
      expect(result.get('table-b')).toEqual([row2]);
    });
  });

  describe('computeRows', () => {
    it('should collect formula errors from plugin', async () => {
      const error = createError('total', 'price * qty');
      const service = createPluginService({
        result: {
          formulaErrors: new Map([['row1', [error]]]),
        },
      });

      const result = await service.computeRows({
        revisionId: 'rev1',
        tableId: 'users',
        rows: [],
      });

      expect(result.formulaErrors?.get('row1')).toEqual([error]);
    });

    it('should merge errors from multiple rows', async () => {
      const error1 = createError('total', 'price * qty');
      const error2 = createError('discount', 'price * 0.1');
      const service = createPluginService({
        result: {
          formulaErrors: new Map([
            ['row1', [error1]],
            ['row2', [error2]],
          ]),
        },
      });

      const result = await service.computeRows({
        revisionId: 'rev1',
        tableId: 'users',
        rows: [],
      });

      expect(result.formulaErrors?.size).toBe(2);
      expect(result.formulaErrors?.get('row1')).toEqual([error1]);
      expect(result.formulaErrors?.get('row2')).toEqual([error2]);
    });

    it('should return empty object when no errors', async () => {
      const service = createPluginService({ result: {} });

      const result = await service.computeRows({
        revisionId: 'rev1',
        tableId: 'users',
        rows: [],
      });

      expect(result).toEqual({});
    });

    it('should skip system tables', async () => {
      const plugin = createMockPlugin({
        formulaErrors: new Map([['row1', [createError('f', 'e')]]]),
      });
      const getTableSchema = jest.fn();
      const service = createPluginService({
        plugin,
        getTableSchema,
      });

      const result = await service.computeRows({
        revisionId: 'rev1',
        tableId: SystemTables.Schema,
        rows: [],
      });

      expect(result).toEqual({});
      expect(plugin.computeRows).not.toHaveBeenCalled();
      expect(getTableSchema).not.toHaveBeenCalled();
    });
  });

  describe('computeRowsWithSchema', () => {
    it('uses the supplied schema for native metadata and formula projection', async () => {
      const fixture = givenNativeMetadataFormulaProjection();

      await fixture.service.computeRowsWithSchema({
        revisionId: 'revision-1',
        tableId: 'products',
        rows: [fixture.row],
        schema: fixture.schema,
      });

      expect(fixture.row.data).toMatchObject({
        identity: 'row-9',
        label: 'row-9',
      });
      expect(fixture.schemaLookup).not.toHaveBeenCalled();
    });
  });

  const pluginService = new PluginService(
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
  );

  function createRow(
    versionId: string,
    data: Record<string, unknown> = {},
  ): Row {
    return { versionId, data } as Row;
  }

  function givenNativeMetadataFormulaProjection() {
    const schemaLookup = jest.fn();
    const plugins = {
      orderedPlugins: [new RowIdPlugin(), new FormulaPlugin()],
    } as unknown as PluginListService;
    const service = new PluginService(
      { getTableSchema: schemaLookup } as never,
      null as never,
      null as never,
      new JsonSchemaStoreService(),
      null as never,
      plugins,
    );
    const row = createRow('version-1', { identity: '', label: '' });
    row.id = 'row-9';
    const schema: JsonSchema = getObjectSchema({
      identity: getRefSchema(SystemSchemaIds.RowId),
      label: {
        ...getStringSchema(),
        readOnly: true,
        'x-formula': { version: 1, expression: 'identity' },
      },
    });

    return { service, schemaLookup, row, schema };
  }

  function createError(field: string, expression: string): FormulaFieldError {
    return {
      field,
      expression,
      error: 'test error',
      defaultUsed: true,
    };
  }

  function createMockPlugin(result: ComputeRowsResult) {
    return {
      afterCreateRow: jest.fn(),
      afterUpdateRow: jest.fn(),
      computeRows: jest.fn().mockReturnValue(result),
      afterMigrateRows: jest.fn(),
      isAvailable: true,
    };
  }

  function createPluginService({
    result = {},
    plugin = createMockPlugin(result),
    getTableSchema = jest.fn().mockResolvedValue({
      schema: { type: 'object', properties: {} },
      hash: 'hash123',
    }),
  }: {
    result?: ComputeRowsResult;
    plugin?: ReturnType<typeof createMockPlugin>;
    getTableSchema?: jest.Mock;
  }) {
    const mockPluginListService = {
      orderedPlugins: [plugin],
    } as unknown as PluginListService;

    const mockSchemaStore = {
      create: jest.fn().mockReturnValue({}),
    } as unknown as JsonSchemaStoreService;

    return new PluginService(
      { getTableSchema } as never,
      null as never,
      null as never,
      mockSchemaStore,
      null as never,
      mockPluginListService,
    );
  }
});
