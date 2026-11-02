import { SchemaTable } from '@revisium/schema-toolkit/lib';
import type {
  InitMigration,
  JsonPatch,
  JsonSchema,
  JsonValue,
} from '@revisium/schema-toolkit/types';
import objectHash from 'object-hash';
import { ledgerIdsOf } from 'src/__tests__/fixtures/stored-ledger';
import type { BranchScenarioTestKit } from 'src/__tests__/kit/create-branch-scenario-test-kit';
import { MigrationApiService } from 'src/features/migration/migration-api.service';
import type {
  PlannedTableRepair,
  SchemaLedgerRepairPlan,
} from 'src/features/migration/queries/impl/plan-schema-ledger-repair.query';
import type { BranchScenario } from 'src/__tests__/fixtures/branch-scenario';

export function planRepair(
  kit: BranchScenarioTestKit,
  draft: BranchScenario,
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

export async function lastPublishedMigrationId(
  draft: BranchScenario,
): Promise<string | undefined> {
  const ids = await ledgerIdsOf(draft, 'head');

  return ids.at(-1);
}

export function initAt(
  id: string,
  tableId: string,
  schema: JsonSchema,
): InitMigration {
  return { changeType: 'init', id, tableId, hash: objectHash(schema), schema };
}

export function migratedRowOf(
  kit: BranchScenarioTestKit,
  schema: JsonSchema,
  row: JsonValue,
  patches: readonly JsonPatch[],
): JsonValue | undefined {
  const table = new SchemaTable(schema, kit.schemaRefs);
  table.addRow('row', row);
  table.applyPatches([...patches]);

  return table.getRows().at(0)?.data;
}
