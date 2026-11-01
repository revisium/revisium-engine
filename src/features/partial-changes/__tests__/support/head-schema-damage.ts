import { SchemaTable } from '@revisium/schema-toolkit/lib';
import type {
  JsonPatch,
  JsonSchema,
  JsonValue,
  Migration,
} from '@revisium/schema-toolkit/types';
import objectHash from 'object-hash';
import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { InputJsonValue, Row } from 'src/engine-prisma-types';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';
import {
  replayOf,
  update,
} from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import type { ReplayedLedger } from 'src/features/share/ledger-replay/ledger-replay';
import type { HistoryPatches } from 'src/features/share/queries/impl';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { describeMigration } from './catalogue-reading';
import type { ChangesScenario } from './changes-scenario';
import type { RevisionSide } from './snapshot-reading';

interface MigratedRow {
  readonly id: string;
  readonly data: JsonValue;
}

interface MigratedTable {
  readonly schema: JsonSchema;
  readonly rows: readonly MigratedRow[];
}

export async function completeAsyncMigrationInPlace(
  kit: PartialChangesTestKit,
  draft: ChangesScenario,
  tableId: string,
  patches: JsonPatch[],
): Promise<void> {
  const schemaRow = await draft.row('draft', SystemTables.Schema, tableId);
  const migrated = migrateTable(
    kit,
    schemaRow.data as unknown as JsonSchema,
    await draftRowsOf(kit, draft, tableId),
    patches,
  );

  await rewriteSchemaRowInPlace(kit, schemaRow, migrated.schema);
  await acceptRewrittenCommittedVersions(kit, draft);
  await linkMigratedRows(draft, tableId, migrated.rows);
}

export async function recordLedgerRepair(
  draft: ChangesScenario,
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
  draft: ChangesScenario,
  side: RevisionSide,
  tableId: string,
): Promise<JsonSchema> {
  const row = await draft.row(side, SystemTables.Schema, tableId);

  return row.data as unknown as JsonSchema;
}

export async function describedLedgerOf(
  draft: ChangesScenario,
  side: RevisionSide,
): Promise<string[]> {
  const ledger = await ledgerOf(draft, side);

  return ledger.map(describeMigration);
}

export async function replayedHeadLedgerOf(
  draft: ChangesScenario,
): Promise<ReplayedLedger> {
  return replayOf(...(await ledgerOf(draft, 'head')));
}

async function ledgerOf(
  draft: ChangesScenario,
  side: RevisionSide,
): Promise<Migration[]> {
  const snapshot = await draft.readSnapshot();

  return snapshot.systemRows.migrations[side]
    .map(({ data }) => data as unknown as Migration)
    .sort((left, right) => compareCodePoints(left.id, right.id));
}

function migrateTable(
  kit: PartialChangesTestKit,
  schema: JsonSchema,
  rows: readonly Row[],
  patches: JsonPatch[],
): MigratedTable {
  const table = new SchemaTable(schema, kit.replayRules.refs);

  for (const row of rows) {
    table.addRow(row.id, row.data as JsonValue);
  }

  table.applyPatches(patches);

  return { schema: table.getSchema(), rows: table.getRows() };
}

async function draftRowsOf(
  kit: PartialChangesTestKit,
  draft: ChangesScenario,
  tableId: string,
): Promise<Row[]> {
  return kit.prisma.row.findMany({
    where: {
      tables: {
        some: { versionId: await draft.tableVersionId('draft', tableId) },
      },
    },
  });
}

async function rewriteSchemaRowInPlace(
  kit: PartialChangesTestKit,
  schemaRow: Row,
  schema: JsonSchema,
): Promise<void> {
  await kit.prisma.row.update({
    where: { versionId: schemaRow.versionId },
    data: { data: schema as InputJsonValue, hash: objectHash(schema) },
  });
}

async function acceptRewrittenCommittedVersions(
  kit: PartialChangesTestKit,
  draft: ChangesScenario,
): Promise<void> {
  kit.guard.forget();
  kit.guard.track(draft.branchId);
  await kit.guard.verify();
}

async function linkMigratedRows(
  draft: ChangesScenario,
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
