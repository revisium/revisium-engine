import { SchemaTable } from '@revisium/schema-toolkit/lib';
import type {
  JsonPatch,
  JsonSchema,
  JsonValue,
} from '@revisium/schema-toolkit/types';
import objectHash from 'object-hash';
import type { BranchScenarioTestKit } from 'src/__tests__/kit/create-branch-scenario-test-kit';
import type { InputJsonValue, Row } from 'src/engine-prisma-types';
import type { RevisionSide } from 'src/features/draft-revision/commands/impl';
import type { HistoryPatches } from 'src/features/share/queries/impl';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { update } from './ledger-steps';
import type { BranchScenario } from './branch-scenario';

interface MigratedRow {
  readonly id: string;
  readonly data: JsonValue;
}

interface MigratedTable {
  readonly schema: JsonSchema;
  readonly rows: readonly MigratedRow[];
}

export async function completeAsyncMigrationInPlace(
  kit: BranchScenarioTestKit,
  draft: BranchScenario,
  tableId: string,
  patches: JsonPatch[],
): Promise<void> {
  const schemaRow = await draft.row('draft', SystemTables.Schema, tableId);
  const migrated = migrateTable(
    kit,
    schemaRow.data as unknown as JsonSchema,
    await draft.rows('draft', tableId),
    patches,
  );

  await rewriteSchemaRowInPlace(kit, schemaRow, migrated.schema);
  await acceptDamagedCommittedVersions(kit, draft);
  await linkMigratedRows(draft, tableId, migrated.rows);
}

export async function recordLedgerRepair(
  draft: BranchScenario,
  tableId: string,
  patches: JsonPatch[],
): Promise<void> {
  const schemaRow = await draft.row('draft', SystemTables.Schema, tableId);
  const history = schemaRow.meta as unknown as HistoryPatches[];

  await draft.rewriteSchemaHistory(tableId, [
    ...history,
    historyEntryOf(patches, schemaRow.data as unknown as JsonSchema),
  ]);
  await draft.recordPendingMigration(update(tableId, patches));
}

export async function schemaRowOf(
  draft: BranchScenario,
  side: RevisionSide,
  tableId: string,
): Promise<JsonSchema> {
  const row = await draft.row(side, SystemTables.Schema, tableId);

  return row.data as unknown as JsonSchema;
}

export async function acceptDamagedCommittedVersions(
  kit: BranchScenarioTestKit,
  draft: BranchScenario,
): Promise<void> {
  kit.guard.forget();
  kit.guard.track(draft.branchId);
  await kit.guard.verify();
}

function migrateTable(
  kit: BranchScenarioTestKit,
  schema: JsonSchema,
  rows: readonly Row[],
  patches: JsonPatch[],
): MigratedTable {
  const table = new SchemaTable(schema, kit.schemaRefs);

  for (const row of rows) {
    table.addRow(row.id, row.data as JsonValue);
  }

  table.applyPatches(patches);

  return { schema: table.getSchema(), rows: table.getRows() };
}

async function rewriteSchemaRowInPlace(
  kit: BranchScenarioTestKit,
  schemaRow: Row,
  schema: JsonSchema,
): Promise<void> {
  await kit.prisma.row.update({
    where: { versionId: schemaRow.versionId },
    data: { data: schema as InputJsonValue, hash: objectHash(schema) },
  });
}

async function linkMigratedRows(
  draft: BranchScenario,
  tableId: string,
  rows: readonly MigratedRow[],
): Promise<void> {
  for (const { id, data } of rows) {
    await draft.updateRow(tableId, id, data as InputJsonValue);
  }
}

function historyEntryOf(
  patches: JsonPatch[],
  schema: JsonSchema,
): HistoryPatches {
  return { patches, hash: objectHash(schema), date: new Date().toISOString() };
}
