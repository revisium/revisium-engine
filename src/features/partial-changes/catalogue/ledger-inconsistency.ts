import type { CatalogueTables } from 'src/features/partial-changes/catalogue/catalogue-tables';
import {
  publicTableIdOf,
  type TablePair,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { LedgerAttribution } from 'src/features/partial-changes/snapshot/ledger-attribution';

export type LedgerInconsistency =
  | {
      readonly reason: 'unattributableMigration';
      readonly tableId: string;
      readonly migrationId: string;
    }
  | { readonly reason: 'historyNotExtendingHead'; readonly tableId: string };

export function ledgerInconsistenciesOf(
  tables: CatalogueTables,
  ledger: LedgerAttribution,
): LedgerInconsistency[] {
  return [
    ...ledger.unattributable.map(
      ({ migration }): LedgerInconsistency => ({
        reason: 'unattributableMigration',
        tableId: migration.tableId,
        migrationId: migration.id,
      }),
    ),
    ...tables.pairs
      .filter((pair) => historyDoesNotExtendHead(tables, pair))
      .map(
        (pair): LedgerInconsistency => ({
          reason: 'historyNotExtendingHead',
          tableId: publicTableIdOf(pair),
        }),
      ),
  ];
}

function historyDoesNotExtendHead(
  tables: CatalogueTables,
  pair: TablePair,
): boolean {
  if (!pair.head || !pair.draft) {
    return false;
  }

  return !tables.structureOf(pair).pendingHistory.extendsHead;
}
