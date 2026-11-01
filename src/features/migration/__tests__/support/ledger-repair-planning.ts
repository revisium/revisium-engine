import { SchemaTable } from '@revisium/schema-toolkit/lib';
import type {
  InitMigration,
  JsonPatch,
  JsonSchema,
  JsonValue,
  Migration,
} from '@revisium/schema-toolkit/types';
import objectHash from 'object-hash';
import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import { sql, type InputJsonValue } from 'src/engine-prisma-types';
import { MigrationApiService } from 'src/features/migration/migration-api.service';
import type {
  PlannedTableRepair,
  SchemaLedgerRepairPlan,
} from 'src/features/migration/queries/impl/plan-schema-ledger-repair.query';
import { MigrationStatus } from 'src/features/migration/types/migration.types';
import type { ChangesScenario } from 'src/features/partial-changes/__tests__/support/changes-scenario';
import type { RevisionSide } from 'src/features/partial-changes/__tests__/support/snapshot-reading';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';
import { createMigrationRecord } from './migration-database';

interface RevisionContents {
  readonly revision: unknown;
  readonly tableVersions: string;
  readonly rowLinks: number;
  readonly rows: string;
  readonly migrationRecords: number;
}

export function planRepair(
  kit: PartialChangesTestKit,
  draft: ChangesScenario,
  tableIds?: readonly string[],
): Promise<SchemaLedgerRepairPlan> {
  return kit.module
    .get(MigrationApiService)
    .planSchemaLedgerRepair({ ...draft.branch, tableIds });
}

export function repairOf(
  plan: SchemaLedgerRepairPlan,
  tableId: string,
): PlannedTableRepair {
  const repair = plan.tables.find((table) => table.tableId === tableId);

  if (!repair) {
    throw new Error(`The plan has no entry for ${tableId}`);
  }

  return repair;
}

export function expectStrictlyAscending(
  ids: readonly (string | undefined)[],
): void {
  const definedIds = ids.filter((id): id is string => id !== undefined);

  expect(ids).toEqual([...new Set(definedIds)].sort(compareCodePoints));
}

export async function lastPublishedMigrationId(
  draft: ChangesScenario,
): Promise<string | undefined> {
  const ids = await ledgerIdsOf(draft, 'head');

  return ids.at(-1);
}

export function pendingMigrationIds(draft: ChangesScenario): Promise<string[]> {
  return draft.pendingMigrationIds();
}

export function initAt(
  id: string,
  tableId: string,
  schema: JsonSchema,
): InitMigration {
  return { changeType: 'init', id, tableId, hash: objectHash(schema), schema };
}

export async function importMigrations(
  kit: PartialChangesTestKit,
  draft: ChangesScenario,
  migrations: Migration[],
): Promise<void> {
  const results = await kit.draftApi.applyMigrations({
    revisionId: await draft.revisionId('draft'),
    migrations,
  });

  expect(results.map(({ status }) => status)).toEqual(
    migrations.map(() => 'applied'),
  );
}

export async function writeRowWithoutValidation(
  kit: PartialChangesTestKit,
  draft: ChangesScenario,
  tableId: string,
  rowId: string,
  data: InputJsonValue,
): Promise<void> {
  const revisionId = await draft.revisionId('draft');

  await kit.draftWriteAdmission.runSerializableRevisionWrite(revisionId, () =>
    kit.draftRevisionApi.updateRows({
      revisionId,
      tableId,
      rows: [{ rowId, data }],
    }),
  );
}

export async function givenActiveMigration(
  kit: PartialChangesTestKit,
  draft: ChangesScenario,
  tableId: string,
): Promise<void> {
  await createMigrationRecord(
    kit.prisma,
    await draft.revisionId('draft'),
    MigrationStatus.PENDING,
    { tableId },
  );
}

export function branchContentsOf(
  kit: PartialChangesTestKit,
  draft: ChangesScenario,
): Promise<RevisionContents[]> {
  return kit.prisma.$queryRaw<RevisionContents[]>(sql`
    SELECT to_jsonb(rev) AS "revision",
           (SELECT md5(coalesce(string_agg(to_jsonb(t)::text, ',' ORDER BY t."versionId"), ''))
              FROM "_RevisionToTable" rt JOIN "Table" t ON t."versionId" = rt."B"
             WHERE rt."A" = rev."id") AS "tableVersions",
           (SELECT count(*) FROM "_RevisionToTable" rt
              JOIN "_RowToTable" rr ON rr."B" = rt."B"
             WHERE rt."A" = rev."id")::int AS "rowLinks",
           (SELECT md5(coalesce(string_agg(to_jsonb(r)::text, ',' ORDER BY rr."B", r."versionId"), ''))
              FROM "_RevisionToTable" rt
              JOIN "_RowToTable" rr ON rr."B" = rt."B"
              JOIN "Row" r ON r."versionId" = rr."A"
             WHERE rt."A" = rev."id") AS "rows",
           (SELECT count(*) FROM "TableMigration" tm
             WHERE tm."revisionId" = rev."id")::int AS "migrationRecords"
    FROM "Revision" rev
    WHERE rev."branchId" = ${draft.branchId}
    ORDER BY rev."id"
  `);
}

async function ledgerIdsOf(
  draft: ChangesScenario,
  side: RevisionSide,
): Promise<string[]> {
  const snapshot = await draft.readSnapshot();

  return snapshot.systemRows.migrations[side]
    .map(({ id }) => id)
    .sort(compareCodePoints);
}

export function migratedRowOf(
  kit: PartialChangesTestKit,
  schema: JsonSchema,
  row: JsonValue,
  patches: readonly JsonPatch[],
): JsonValue | undefined {
  const table = new SchemaTable(schema, kit.schemaRefs);
  table.addRow('row', row);
  table.applyPatches([...patches]);

  return table.getRows().at(0)?.data;
}
