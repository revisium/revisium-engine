import type { JsonSchema, Migration } from '@revisium/schema-toolkit/types';
import type { Row } from 'src/engine-prisma-types';
import type { RevisionSide } from 'src/features/draft-revision/commands/impl';
import type { ReplayedLedger } from 'src/features/share/ledger-replay/ledger-replay';
import {
  type LedgerEntry,
  ledgerOf,
  migrationsOf,
  splitLedger,
} from 'src/features/share/ledger/migration-ledger';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';
import { replayOf } from './ledger-steps';
import type { BranchScenario } from './branch-scenario';

type ChangeType = Migration['changeType'];

export async function storedLedgerOf(
  draft: BranchScenario,
  side: RevisionSide,
): Promise<Migration[]> {
  return migrationsOf(ledgerOf(await ledgerRowsOf(draft, side)));
}

export async function ledgerIdsOf(
  draft: BranchScenario,
  side: RevisionSide,
): Promise<string[]> {
  const rows = await ledgerRowsOf(draft, side);

  return rows.map(({ id }) => id);
}

export async function storedSchemasOf(
  draft: BranchScenario,
  side: RevisionSide,
): Promise<Record<string, JsonSchema>> {
  const schemaRows = await draft.rows(side, SystemTables.Schema);

  return Object.fromEntries(
    schemaRows.map(({ id, data }) => [id, data as unknown as JsonSchema]),
  );
}

export async function describedLedgerOf(
  draft: BranchScenario,
  side: RevisionSide,
): Promise<string[]> {
  const ledger = await storedLedgerOf(draft, side);

  return ledger.map(describeMigration);
}

export async function replayedHeadLedgerOf(
  draft: BranchScenario,
): Promise<ReplayedLedger> {
  return replayOf(...(await storedLedgerOf(draft, 'head')));
}

export async function pendingMigrationIds(
  draft: BranchScenario,
): Promise<string[]> {
  const pending = await pendingLedgerOf(draft);

  return pending.map(({ row }) => row.id);
}

export async function pendingMigrationOf(
  draft: BranchScenario,
  changeType: ChangeType,
  tableId: string,
): Promise<Migration> {
  const pending = migrationsOf(await pendingLedgerOf(draft));
  const migration = migrationOfTable(pending, changeType, tableId);

  if (!migration) {
    throw new Error(`The Draft has no pending ${changeType} of ${tableId}`);
  }

  return migration;
}

export async function draftMigrationOf(
  draft: BranchScenario,
  changeType: ChangeType,
  tableId: string,
): Promise<Migration> {
  const ledger = await storedLedgerOf(draft, 'draft');
  const migration = migrationOfTable(ledger, changeType, tableId);

  if (!migration) {
    throw new Error(`The Draft ledger has no ${changeType} of ${tableId}`);
  }

  return migration;
}

export async function migrationIdOf(
  draft: BranchScenario,
  changeType: ChangeType,
  tableId: string,
): Promise<string> {
  const migration = await draftMigrationOf(draft, changeType, tableId);

  return migration.id;
}

export function expectStrictlyAscending(
  ids: readonly (string | undefined)[],
): void {
  const definedIds = ids.filter((id): id is string => id !== undefined);

  expect(ids).toEqual([...new Set(definedIds)].sort(compareCodePoints));
}

export function describeMigration(migration: Migration): string {
  if (migration.changeType === 'rename') {
    return `rename ${migration.tableId} to ${migration.nextTableId}`;
  }

  return `${migration.changeType} ${migration.tableId}`;
}

async function pendingLedgerOf(
  draft: BranchScenario,
): Promise<readonly LedgerEntry[]> {
  const { pending } = splitLedger(
    await ledgerRowsOf(draft, 'head'),
    await ledgerRowsOf(draft, 'draft'),
  );

  return pending;
}

function ledgerRowsOf(
  draft: BranchScenario,
  side: RevisionSide,
): Promise<Row[]> {
  return draft.rows(side, SystemTables.Migration);
}

function migrationOfTable(
  ledger: readonly Migration[],
  changeType: ChangeType,
  tableId: string,
): Migration | undefined {
  return ledger.find(
    (migration) =>
      migration.changeType === changeType && migration.tableId === tableId,
  );
}
