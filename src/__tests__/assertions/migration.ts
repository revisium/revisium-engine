import type { MigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';
import { MigrationStatus } from 'src/features/migration/types/migration.types';

const DEFAULT_MIGRATION_WAIT_TIMEOUT_MS = 10_000;

export async function waitForMigration(
  kit: MigrationTestKit,
  revisionId: string,
  tableId: string,
  maxWaitMs = DEFAULT_MIGRATION_WAIT_TIMEOUT_MS,
) {
  const pollInterval = 50;
  let waited = 0;

  while (waited < maxWaitMs) {
    const status = await kit.migrationApi.getMigrationStatus({
      revisionId,
      tableId,
    });

    if (!status) {
      return null;
    }

    if (
      status.status === MigrationStatus.FAILED ||
      status.status === MigrationStatus.CANCELLED
    ) {
      return status;
    }

    if (status.status === MigrationStatus.COMPLETED) {
      await sleep(pollInterval);
      waited += pollInterval;
      continue;
    }

    await sleep(pollInterval);
    waited += pollInterval;
  }

  throw new Error(`Migration did not complete within ${maxWaitMs}ms`);
}

export async function waitForMigrationStatus(
  kit: MigrationTestKit,
  revisionId: string,
  tableId: string,
  targetStatus: MigrationStatus,
  maxWaitMs = DEFAULT_MIGRATION_WAIT_TIMEOUT_MS,
) {
  const pollInterval = 50;
  let waited = 0;

  while (waited < maxWaitMs) {
    const status = await kit.migrationApi.getMigrationStatus({
      revisionId,
      tableId,
    });

    if (status?.status === targetStatus) {
      return status;
    }

    await sleep(pollInterval);
    waited += pollInterval;
  }

  throw new Error(
    `Migration did not reach ${targetStatus} within ${maxWaitMs}ms`,
  );
}

export async function expectMigrationToFinish(
  kit: MigrationTestKit,
  revisionId: string,
  tableId: string,
): Promise<void> {
  const status = await waitForMigration(kit, revisionId, tableId);

  if (status?.status === MigrationStatus.FAILED) {
    throw new Error(`Migration failed: ${status.errorMessage}`);
  }

  if (status?.status === MigrationStatus.CANCELLED) {
    throw new Error('Migration was cancelled unexpectedly');
  }

  expect(status).toBeNull();
}

export async function expectMigrationAbsent(
  kit: MigrationTestKit,
  revisionId: string,
  tableId: string,
): Promise<void> {
  const status = await kit.migrationApi.getMigrationStatus({
    revisionId,
    tableId,
  });

  expect(status).toBeNull();
}

export async function getDraftSchemaData(
  kit: MigrationTestKit,
  revisionId: string,
  tableId: string,
) {
  const schemaTable = await kit.prisma.table.findFirst({
    where: {
      id: 'revisium_schema_table',
      revisions: { some: { id: revisionId } },
    },
  });

  if (!schemaTable) {
    return null;
  }

  const schemaRow = await kit.prisma.row.findFirst({
    where: {
      id: tableId,
      tables: { some: { versionId: schemaTable.versionId } },
    },
  });

  return schemaRow?.data ?? null;
}

export async function expectDraftSchemaToHaveProperties(
  kit: MigrationTestKit,
  revisionId: string,
  tableId: string,
  propertyNames: string[],
): Promise<void> {
  const schema = await getDraftSchemaData(kit, revisionId, tableId);
  const properties = (schema as Record<string, unknown> | null)?.properties as
    | Record<string, unknown>
    | undefined;

  for (const propertyName of propertyNames) {
    expect(properties).toHaveProperty(propertyName);
  }
}

export async function expectRowsToHaveProperties(
  kit: MigrationTestKit,
  revisionId: string,
  tableId: string,
  rowIds: string[],
  propertyNames: string[],
): Promise<void> {
  for (const rowId of rowIds) {
    const row = await kit.rowApi.getRow({
      revisionId,
      tableId,
      rowId,
    });

    expect(row).not.toBeNull();
    const data = row?.data as Record<string, unknown>;

    for (const propertyName of propertyNames) {
      expect(data).toHaveProperty(propertyName);
    }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
