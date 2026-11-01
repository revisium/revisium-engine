import type {
  JsonPatch,
  Migration,
  UpdateMigration,
} from '@revisium/schema-toolkit/types';
import objectHash from 'object-hash';
import type { MigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';
import { RevisionsApiService } from 'src/features/revision/revisions-api.service';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import { replayLedger } from 'src/features/share/ledger-replay/ledger-replay';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { TableViewsData } from 'src/features/views/types';

interface TableInRevision {
  revisionId: string;
  tableId: string;
}

export function readLedger(
  kit: MigrationTestKit,
  revisionId: string,
): Promise<Migration[]> {
  return kit.module.get(RevisionsApiService).migrations({ revisionId });
}

export async function readSchema(
  kit: MigrationTestKit,
  table: TableInRevision,
): Promise<unknown> {
  const schemaRow = await readSystemRow(kit, SystemTables.Schema, table);

  return schemaRow?.data;
}

export async function readViews(
  kit: MigrationTestKit,
  table: TableInRevision,
): Promise<TableViewsData | undefined> {
  const viewsRow = await readSystemRow(kit, SystemTables.Views, table);

  return viewsRow?.data as TableViewsData | undefined;
}

export function readSystemRow(
  kit: MigrationTestKit,
  systemTableId: SystemTables,
  { revisionId, tableId }: TableInRevision,
) {
  return kit.prisma.row.findFirst({
    where: {
      id: tableId,
      tables: {
        some: { id: systemTableId, revisions: { some: { id: revisionId } } },
      },
    },
  });
}

export function readRevisionContents(
  kit: MigrationTestKit,
  revisionId: string,
) {
  return kit.prisma.revision.findUniqueOrThrow({
    where: { id: revisionId },
    select: {
      hasChanges: true,
      tables: {
        orderBy: { versionId: 'asc' },
        select: {
          versionId: true,
          id: true,
          rows: {
            orderBy: { versionId: 'asc' },
            select: { versionId: true, id: true, hash: true, meta: true },
          },
        },
      },
    },
  });
}

export async function readDraftState(
  kit: MigrationTestKit,
  table: TableInRevision,
) {
  return {
    schemaRow: await readSystemRow(kit, SystemTables.Schema, table),
    viewsRow: await readSystemRow(kit, SystemTables.Views, table),
    ledger: await readLedger(kit, table.revisionId),
    linkedVersions: await readRevisionContents(kit, table.revisionId),
  };
}

export async function readDraftTableVersionId(
  kit: MigrationTestKit,
  { revisionId, tableId }: TableInRevision,
): Promise<string> {
  const table = await kit.prisma.table.findFirstOrThrow({
    where: { id: tableId, revisions: { some: { id: revisionId } } },
  });

  return table.versionId;
}

export async function expectOneRecordedUpdate(
  kit: MigrationTestKit,
  table: TableInRevision,
  patches: JsonPatch[],
): Promise<UpdateMigration> {
  const updates = (await readLedger(kit, table.revisionId)).filter(
    (migration): migration is UpdateMigration =>
      migration.changeType === 'update' && migration.tableId === table.tableId,
  );

  expect(updates).toEqual([
    {
      changeType: 'update',
      tableId: table.tableId,
      id: expect.any(String),
      hash: objectHash((await readSchema(kit, table)) as object),
      patches,
    },
  ]);

  return updates[0] as UpdateMigration;
}

export async function expectNoRecordedUpdate(
  kit: MigrationTestKit,
  table: TableInRevision,
): Promise<void> {
  const ledger = await readLedger(kit, table.revisionId);

  expect(
    ledger.filter((migration) => migration.changeType === 'update'),
  ).toEqual([]);
}

export function expectNativeMigrationIdAfter(
  migrationId: string,
  previousMigrationId: string,
): void {
  expect(new Date(migrationId).toISOString()).toBe(migrationId);
  expect(migrationId > previousMigrationId).toBe(true);
}

export async function expectSchemaHistoryToEndWith(
  kit: MigrationTestKit,
  table: TableInRevision,
  patches: JsonPatch[],
): Promise<void> {
  const schemaRow = await readSystemRow(kit, SystemTables.Schema, table);
  const history = schemaRow?.meta as unknown[];

  expect(history.at(-1)).toEqual({
    patches,
    hash: objectHash(schemaRow?.data as object),
    date: expect.any(String),
  });
}

export async function expectLedgerToReplaySchema(
  kit: MigrationTestKit,
  table: TableInRevision,
): Promise<void> {
  const replay = replayLedger({
    ledger: await readLedger(kit, table.revisionId),
    refs: kit.module.get(JsonSchemaStoreService).refs,
    validator: kit.module.get(JsonSchemaValidatorService),
  });

  expect(replay.schemas.get(table.tableId)).toEqual(
    await readSchema(kit, table),
  );
}

export async function expectDraftToOwnItsSystemRows(
  kit: MigrationTestKit,
  table: TableInRevision & { headRevisionId: string },
  systemTableIds: SystemTables[],
): Promise<void> {
  for (const systemTableId of systemTableIds) {
    const head = await readSystemRow(kit, systemTableId, {
      revisionId: table.headRevisionId,
      tableId: table.tableId,
    });
    const draft = await readSystemRow(kit, systemTableId, table);

    expect(draft?.readonly).toBe(false);
    expect(draft?.versionId).not.toBe(head?.versionId);
  }
}
