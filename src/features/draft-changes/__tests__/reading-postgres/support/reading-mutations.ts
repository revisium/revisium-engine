import type {
  JsonPatch,
  JsonSchema,
  JsonValue,
} from '@revisium/schema-toolkit/types';
import type { ReadingTestKit } from './reading-test-kit';
import { ViewsApiService } from 'src/features/views/views-api.service';
import type { TableViewsData } from 'src/features/views/types';
import { MigrationStatus } from 'src/features/migration/types/migration.types';
import { createMigrationRecord } from 'src/features/migration/__tests__/support/migration-database';

export interface ReadingMutations {
  updateRow(data: Record<string, JsonValue>): Promise<void>;
  patchSchema(patches: JsonPatch[]): Promise<void>;
  renameRow(nextRowId: string): Promise<void>;
  renameTable(nextTableId: string): Promise<void>;
  createRow(rowId: string, data: Record<string, JsonValue>): Promise<void>;
  createTable(tableId: string, schema: JsonSchema): Promise<void>;
  reuseRowId(data: Record<string, JsonValue>): Promise<void>;
  reuseTableId(): Promise<void>;
  updateViews(views: TableViewsData): Promise<void>;
  startMigration(): Promise<void>;
}

export function createReadingMutations({
  kit,
  branchId,
  schema,
  current,
}: {
  kit: ReadingTestKit;
  branchId: string;
  schema: JsonSchema;
  current: { tableId: string; rowId: string };
}): ReadingMutations {
  async function draftRevisionId(): Promise<string> {
    const revision = await kit.prismaService.revision.findFirstOrThrow({
      where: { branchId, isDraft: true },
      select: { id: true },
    });
    return revision.id;
  }

  return {
    updateRow: async (data) => {
      await kit.draftApiService.apiUpdateRow({
        revisionId: await draftRevisionId(),
        tableId: current.tableId,
        rowId: current.rowId,
        data,
      });
    },
    patchSchema: async (patches) => {
      await kit.draftApiService.apiUpdateTable({
        revisionId: await draftRevisionId(),
        tableId: current.tableId,
        patches,
      });
    },
    renameRow: async (nextRowId) => {
      await kit.draftApiService.apiRenameRow({
        revisionId: await draftRevisionId(),
        tableId: current.tableId,
        rowId: current.rowId,
        nextRowId,
      });
      current.rowId = nextRowId;
    },
    renameTable: async (nextTableId) => {
      await kit.draftApiService.apiRenameTable({
        revisionId: await draftRevisionId(),
        tableId: current.tableId,
        nextTableId,
      });
      current.tableId = nextTableId;
    },
    createRow: async (rowId, data) => {
      await kit.draftApiService.apiCreateRow({
        revisionId: await draftRevisionId(),
        tableId: current.tableId,
        rowId,
        data,
      });
    },
    createTable: async (tableId, tableSchema) => {
      await kit.draftApiService.apiCreateTable({
        revisionId: await draftRevisionId(),
        tableId,
        schema: tableSchema,
      });
    },
    reuseRowId: async (data) => {
      const revisionId = await draftRevisionId();
      await kit.draftApiService.apiRemoveRow({
        revisionId,
        tableId: current.tableId,
        rowId: current.rowId,
      });
      await kit.draftApiService.apiCreateRow({
        revisionId,
        tableId: current.tableId,
        rowId: current.rowId,
        data,
      });
    },
    reuseTableId: async () => {
      const revisionId = await draftRevisionId();
      await kit.draftApiService.apiRemoveTable({
        revisionId,
        tableId: current.tableId,
      });
      await kit.draftApiService.apiCreateTable({
        revisionId,
        tableId: current.tableId,
        schema,
      });
    },
    updateViews: async (views) => {
      await kit.module.get(ViewsApiService).updateTableViews({
        revisionId: await draftRevisionId(),
        tableId: current.tableId,
        viewsData: views,
      });
    },
    startMigration: async () => {
      await createMigrationRecord(
        kit.prismaService,
        await draftRevisionId(),
        MigrationStatus.PENDING,
        { tableId: current.tableId },
      );
    },
  };
}
