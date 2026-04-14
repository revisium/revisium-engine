import { JsonSchemaTypeName } from '@revisium/schema-toolkit/types';
import { nanoid } from 'nanoid';
import objectHash from 'object-hash';
import type { MigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';
import { createMigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';
import { givenMigrationTableWithRows } from 'src/__tests__/fixtures/scenarios/given-migration-table-with-rows';
import {
  expectMigrationAbsent,
  expectRowsToHaveProperties,
  waitForMigration,
} from 'src/__tests__/assertions/migration';
import { MigrationStatus } from 'src/features/migration/types/migration.types';
import type { InputJsonValue } from 'src/engine-prisma-types';
import {
  prepareBranch,
  prepareTableWithSchema,
} from 'src/__tests__/utils/prepareProject';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { tableViewsSchema } from 'src/features/share/schema/table-views-schema';
import type { TableViewsData } from 'src/features/views/types';

const TEST_THRESHOLD = 10;
const ROW_COUNT = 15;

const testSchema = {
  type: JsonSchemaTypeName.Object as const,
  required: ['ver'],
  properties: {
    ver: { type: JsonSchemaTypeName.Number as const, default: 0 },
  },
  additionalProperties: false as const,
};

function createViewsData(): TableViewsData {
  return {
    version: 1,
    defaultViewId: 'main',
    views: [
      {
        id: 'main',
        name: 'Main',
        columns: [{ field: 'data.ver', width: 100 }],
        filters: {
          logic: 'and',
          conditions: [{ field: 'data.ver', operator: 'equals', value: 1 }],
        },
        sorts: [{ field: 'data.ver', direction: 'asc' }],
      },
    ],
  };
}

describe('Async Update Table', () => {
  let kit: MigrationTestKit;

  beforeAll(async () => {
    kit = await createMigrationTestKit({
      threshold: TEST_THRESHOLD,
      batchSize: 5,
    });
  });

  afterAll(async () => {
    if (kit) {
      await kit.close();
    }
  });

  async function prepareTableWithRows() {
    return givenMigrationTableWithRows({
      prisma: kit.prisma,
      schema: testSchema,
      rowCount: ROW_COUNT,
    });
  }

  async function setupViews(
    revisionId: string,
    tableId: string,
    viewsData: TableViewsData,
  ) {
    let viewsTable = await kit.prisma.table.findFirst({
      where: {
        id: SystemTables.Views,
        revisions: { some: { id: revisionId } },
      },
    });

    if (!viewsTable) {
      viewsTable = await kit.prisma.table.create({
        data: {
          id: SystemTables.Views,
          versionId: nanoid(),
          createdId: nanoid(),
          readonly: false,
          system: true,
          revisions: {
            connect: { id: revisionId },
          },
        },
      });
    }

    await kit.prisma.row.create({
      data: {
        id: tableId,
        versionId: nanoid(),
        createdId: nanoid(),
        readonly: false,
        data: viewsData as unknown as InputJsonValue,
        hash: objectHash(viewsData),
        schemaHash: objectHash(tableViewsSchema),
        tables: {
          connect: { versionId: viewsTable.versionId },
        },
      },
    });
  }

  async function getViewsData(
    revisionId: string,
    tableId: string,
  ): Promise<TableViewsData | null> {
    const viewsTable = await kit.prisma.table.findFirst({
      where: {
        id: SystemTables.Views,
        revisions: { some: { id: revisionId } },
      },
    });
    if (!viewsTable) {
      return null;
    }

    const viewsRow = await kit.prisma.row.findFirst({
      where: {
        id: tableId,
        tables: { some: { versionId: viewsTable.versionId } },
      },
    });

    return (viewsRow?.data as TableViewsData | undefined) ?? null;
  }

  it('should use sync path for table below threshold', async () => {
    const branchData = await prepareBranch(kit.prisma);
    const tableResult = await prepareTableWithSchema({
      prismaService: kit.prisma,
      headRevisionId: branchData.headRevisionId,
      draftRevisionId: branchData.draftRevisionId,
      schemaTableVersionId: branchData.schemaTableVersionId,
      migrationTableVersionId: branchData.migrationTableVersionId,
      schema: testSchema,
    });

    // 0 rows — below threshold
    const result = await kit.draftApi.apiUpdateTable({
      revisionId: branchData.draftRevisionId,
      tableId: tableResult.tableId,
      patches: [
        {
          op: 'add',
          path: '/properties/name',
          value: { type: JsonSchemaTypeName.String, default: '' },
        },
      ],
    });

    expect(result.table).not.toBeNull();
    expect(result.migrationId).toBeUndefined();
  });

  it('should detect threshold correctly with row count', async () => {
    const { draftTableVersionId } = await prepareTableWithRows();

    const count = await kit.migrationService.countRows(draftTableVersionId);
    expect(count).toBe(ROW_COUNT);

    const shouldAsync =
      await kit.migrationService.shouldUseAsyncMigration(draftTableVersionId);
    expect(shouldAsync).toBe(true);
  });

  it('should trigger async path for table above threshold', async () => {
    const { draftRevisionId, tableId } = await prepareTableWithRows();

    const result = await kit.draftApi.apiUpdateTable({
      revisionId: draftRevisionId,
      tableId,
      patches: [
        {
          op: 'add',
          path: '/properties/name',
          value: { type: JsonSchemaTypeName.String, default: '' },
        },
      ],
    });

    expect(result.migrationId).toBeDefined();
    expect(result.migrationStatus).toBe('migrating');
  });

  it('should complete async migration and produce correct rows', async () => {
    const { draftRevisionId, tableId, rowIds } = await prepareTableWithRows();

    const result = await kit.draftApi.apiUpdateTable({
      revisionId: draftRevisionId,
      tableId,
      patches: [
        {
          op: 'add',
          path: '/properties/label',
          value: { type: JsonSchemaTypeName.String, default: '' },
        },
      ],
    });

    expect(result.migrationId).toBeDefined();

    await waitForMigration(kit, draftRevisionId, tableId);
    await expectMigrationAbsent(kit, draftRevisionId, tableId);
    await expectRowsToHaveProperties(kit, draftRevisionId, tableId, rowIds, [
      'label',
    ]);
  });

  it('should migrate table views during async swap', async () => {
    const { draftRevisionId, tableId } = await prepareTableWithRows();
    await setupViews(draftRevisionId, tableId, createViewsData());

    const result = await kit.draftApi.apiUpdateTable({
      revisionId: draftRevisionId,
      tableId,
      patches: [
        {
          op: 'move',
          from: '/properties/ver',
          path: '/properties/version',
        },
      ],
    });

    expect(result.migrationId).toBeDefined();

    await waitForMigration(kit, draftRevisionId, tableId);

    const viewsData = await getViewsData(draftRevisionId, tableId);
    expect(viewsData?.views[0]?.columns).toEqual([
      { field: 'data.version', width: 100 },
    ]);
    expect(viewsData?.views[0]?.sorts).toEqual([
      { field: 'data.version', direction: 'asc' },
    ]);
    expect(viewsData?.views[0]?.filters?.conditions).toEqual([
      { field: 'data.version', operator: 'equals', value: 1 },
    ]);
  });

  it('should report active migrations during copy', async () => {
    const { draftRevisionId, tableId } = await prepareTableWithRows();

    // Create a PENDING migration manually
    await kit.prisma.tableMigration.create({
      data: {
        revisionId: draftRevisionId,
        tableId,
        sourceTableVersionId: 'fake-source',
        status: MigrationStatus.COPYING,
        phase: 'COPYING',
        patches: [],
        previousSchema: {},
        previousSchemaHash: 'h1',
        targetSchemaHash: 'h2',
        totalRows: ROW_COUNT,
        copiedRows: 5,
      },
    });

    const active = await kit.migrationApi.getActiveMigrations({
      revisionId: draftRevisionId,
    });
    expect(active.length).toBe(1);
    expect(active[0]?.tableId).toBe(tableId);
    expect(active[0]?.progress.copiedRows).toBe(5);
  });

  it('should abort an in-progress migration', async () => {
    const { draftRevisionId } = await prepareBranch(kit.prisma);

    await kit.prisma.tableMigration.create({
      data: {
        revisionId: draftRevisionId,
        tableId: 'abort-test-table',
        sourceTableVersionId: 'fake-source',
        status: MigrationStatus.COPYING,
        phase: 'COPYING',
        patches: [],
        previousSchema: {},
        previousSchemaHash: 'h1',
        targetSchemaHash: 'h2',
        totalRows: 100,
        copiedRows: 30,
      },
    });

    await kit.migrationApi.abortMigration({
      revisionId: draftRevisionId,
      tableId: 'abort-test-table',
    });

    await expectMigrationAbsent(kit, draftRevisionId, 'abort-test-table');
  });
});
