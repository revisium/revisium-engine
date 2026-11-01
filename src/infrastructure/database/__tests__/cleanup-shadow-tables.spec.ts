import { JsonSchemaTypeName } from '@revisium/schema-toolkit/types';
import {
  expectMigrationToFinish,
  expectRowsToHaveProperties,
  observeCommittedVersions,
} from 'src/__tests__/assertions/migration';
import { givenMigrationTableWithRows } from 'src/__tests__/fixtures/scenarios/given-migration-table-with-rows';
import type { MigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';
import { createMigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';
import { prepareBranch } from 'src/__tests__/utils/prepareProject';
import {
  createMigrationRecord,
  createShadowTableWithRows,
  ShadowTableFixture,
} from 'src/features/migration/__tests__/support/migration-database';
import {
  ACTIVE_MIGRATION_STATUSES,
  MigrationStatus,
} from 'src/features/migration/types/migration.types';
import { CleanupService } from 'src/infrastructure/database/cleanup.service';

const BATCH_SIZE = 5;
const ROW_COUNT = 3 * BATCH_SIZE;
const SHADOW_ROW_COUNT = 2;
const MIGRATED_TABLE_ID = 'products';

const ABANDONED_MIGRATION_STATUSES = [
  MigrationStatus.FAILED,
  MigrationStatus.CANCELLED,
];

const productSchema = {
  type: JsonSchemaTypeName.Object as const,
  required: ['ver'],
  properties: {
    ver: { type: JsonSchemaTypeName.Number as const, default: 0 },
  },
  additionalProperties: false as const,
};

describe('CleanupService and shadow tables of async migrations', () => {
  let kit: MigrationTestKit;
  let cleanupService: CleanupService;

  beforeAll(async () => {
    kit = await createMigrationTestKit({ batchSize: BATCH_SIZE });
    cleanupService = kit.module.get(CleanupService);
  });

  afterEach(async () => {
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  it('lets a migration finish when cleanup runs between its copy batches', async () => {
    const draft = await givenMigrationTableWithRows({
      prisma: kit.prisma,
      schema: productSchema,
      rowCount: ROW_COUNT,
    });
    await observeCommittedVersions(kit, draft.branchId);

    await duringCopyOfFieldAddition(kit, draft, 'price', () =>
      cleanupService.cleanOrphanedData(),
    );

    await expectMigrationToFinish(kit, draft.draftRevisionId, draft.tableId);
    await expectRowsToHaveProperties(
      kit,
      draft.draftRevisionId,
      draft.tableId,
      draft.rowIds,
      ['price'],
    );
  });

  it.each(ACTIVE_MIGRATION_STATUSES)(
    'keeps the shadow table and its rows of a %s migration',
    async (status) => {
      const shadowTable = await givenMigrationWithShadowTable(kit, status);

      await cleanupService.cleanOrphanedData();

      await expectShadowTableWithRows(kit, shadowTable);
    },
  );

  it.each(ABANDONED_MIGRATION_STATUSES)(
    'deletes the shadow table and its rows of a %s migration',
    async (status) => {
      const shadowTable = await givenMigrationWithShadowTable(kit, status);

      await cleanupService.cleanOrphanedData();

      await expectShadowTableAndRowsDeleted(kit, shadowTable);
    },
  );
});

async function expectShadowTableWithRows(
  kit: MigrationTestKit,
  shadowTable: ShadowTableFixture,
): Promise<void> {
  const table = await kit.prisma.table.findUnique({
    where: { versionId: shadowTable.versionId },
    include: { rows: { select: { versionId: true } } },
  });

  expect(table).not.toBeNull();
  expect(new Set(table?.rows.map((row) => row.versionId))).toEqual(
    new Set(shadowTable.rowVersionIds),
  );
}

async function expectShadowTableAndRowsDeleted(
  kit: MigrationTestKit,
  shadowTable: ShadowTableFixture,
): Promise<void> {
  const table = await kit.prisma.table.findUnique({
    where: { versionId: shadowTable.versionId },
  });
  const remainingRows = await kit.prisma.row.count({
    where: { versionId: { in: shadowTable.rowVersionIds } },
  });

  expect(table).toBeNull();
  expect(remainingRows).toBe(0);
}

async function givenMigrationWithShadowTable(
  kit: MigrationTestKit,
  status: MigrationStatus,
): Promise<ShadowTableFixture> {
  const branch = await prepareBranch(kit.prisma);

  return kit.prisma.$transaction(async (transaction) => {
    const shadowTable = await createShadowTableWithRows(
      transaction,
      MIGRATED_TABLE_ID,
      SHADOW_ROW_COUNT,
    );

    await createMigrationRecord(transaction, branch.draftRevisionId, status, {
      tableId: MIGRATED_TABLE_ID,
      shadowTableVersionId: shadowTable.versionId,
      ...heldByRunningWorker(),
    });

    return shadowTable;
  });
}

// A live lease keeps these fixture records out of any recovery sweep that another spec runs.
function heldByRunningWorker() {
  return { lockedBy: 'cleanup-spec-worker', heartbeatAt: new Date() };
}

async function duringCopyOfFieldAddition(
  kit: MigrationTestKit,
  draft: { draftRevisionId: string; tableId: string },
  field: string,
  action: () => Promise<unknown>,
): Promise<void> {
  const copy = holdCopyBeforeSecondBatch(kit);

  try {
    const { migrationId } = await kit.draftApi.apiUpdateTable({
      revisionId: draft.draftRevisionId,
      tableId: draft.tableId,
      patches: [
        {
          op: 'add',
          path: `/properties/${field}`,
          value: { type: JsonSchemaTypeName.Number, default: 0 },
        },
      ],
    });
    expect(migrationId).toBeDefined();

    await copy.reached;
    await action();
  } finally {
    copy.release();
    copy.restore();
  }
}

function holdCopyBeforeSecondBatch(kit: MigrationTestKit) {
  const batchService = kit.migrationBatchService;
  const loadBatchRows = batchService.loadBatchRows.bind(batchService);
  let loadedBatches = 0;
  let arrive!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });

  const spy = jest
    .spyOn(batchService, 'loadBatchRows')
    .mockImplementation(async (...args) => {
      loadedBatches += 1;

      if (loadedBatches === 2) {
        arrive();
        await released;
      }

      return loadBatchRows(...args);
    });

  return {
    reached,
    release,
    restore: () => spy.mockRestore(),
  };
}
