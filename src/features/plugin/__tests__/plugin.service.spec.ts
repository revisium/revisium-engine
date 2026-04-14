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

  const pluginService = new PluginService(
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
  );

  function createRow(versionId: string): Row {
    return { versionId } as Row;
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
