import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { LedgerInconsistency } from 'src/features/partial-changes/catalogue/ledger-inconsistency';
import type { UnitAddress } from 'src/features/partial-changes/catalogue/unit';
import {
  REFUSAL_CODES,
  type RefusalCode,
  type RefusedTable,
} from 'src/features/partial-changes/head-schema/head-schema-check';
import type { CatalogueReason } from 'src/features/partial-changes/plan/reason';
import {
  publicIdOrIdentityOf,
  type TablePair,
} from 'src/features/partial-changes/snapshot/changes-snapshot';

export const BLOCKER_CODES = [
  'notSelectable',
  'requiredExcluded',
  'danglingInSource',
  'invalidViews',
  'unmatchedSelector',
  'tooLarge',
  'unrecordedStructureChange',
  'ledgerInconsistent',
  'invalidRow',
  'migrationInProgress',
  ...REFUSAL_CODES,
] as const;

export type BlockerCode = (typeof BLOCKER_CODES)[number];

export interface CatalogueBlocker {
  readonly code: BlockerCode;
  readonly tableId?: string;
  readonly rowId?: string;
  readonly path?: string;
  readonly message: string;
  readonly unitKey?: string;
  readonly reason?: CatalogueReason;
}

// A blocker that names no unit, so it reads the same in a plan.
export type PlainBlocker = Omit<CatalogueBlocker, 'unitKey' | 'reason'>;

const REFUSAL_REASONS: Readonly<Record<RefusalCode, string>> = {
  headSchemaInconsistent: 'its Head schema does not match its Head ledger',
  unledgeredTable: 'it has no intact ledger lineage',
};

export function refusalBlocker({
  tableId,
  code,
}: RefusedTable): CatalogueBlocker {
  return {
    code,
    tableId,
    message: `${tableId} is refused: ${REFUSAL_REASONS[code]}`,
  };
}

export function requiredExcluded(
  { key, unit }: CatalogueUnit,
  reason: CatalogueReason,
): CatalogueBlocker {
  const { tableId, rowId, path } = unit;

  return {
    code: 'requiredExcluded',
    tableId,
    rowId,
    path,
    message: `${addressOf(unit)} is required but excluded`,
    unitKey: key,
    reason,
  };
}

export function unrecordedStructureChangeOf(pair: TablePair): CatalogueBlocker {
  const tableId = publicIdOrIdentityOf(pair);

  return {
    code: 'unrecordedStructureChange',
    tableId,
    message: `The Draft structure of ${tableId} is not reproduced by its schema history and migrations: its commit is refused, and Head rows cannot be migrated into it`,
  };
}

export function ledgerInconsistentBlockerOf(
  inconsistency: LedgerInconsistency,
): CatalogueBlocker {
  return {
    code: 'ledgerInconsistent',
    tableId: inconsistency.tableId,
    message: inconsistencyMessageOf(inconsistency),
  };
}

export function distinctBlockers(
  blockers: readonly CatalogueBlocker[],
): CatalogueBlocker[] {
  const distinct = new Map<string, CatalogueBlocker>();

  for (const blocker of blockers) {
    const { code, tableId, rowId, path } = blocker;
    const key = JSON.stringify([code, tableId, rowId, path]);

    if (!distinct.has(key)) {
      distinct.set(key, blocker);
    }
  }

  return [...distinct.values()];
}

function addressOf({ tableId, rowId, path }: UnitAddress): string {
  if (rowId === undefined) {
    return tableId;
  }

  return `${tableId}/${rowId}${path ?? ''}`;
}

function inconsistencyMessageOf(inconsistency: LedgerInconsistency): string {
  if (inconsistency.reason === 'unattributableMigration') {
    return `Pending migration ${inconsistency.migrationId} of ${inconsistency.tableId} cannot be attributed to a table`;
  }

  return `The Draft schema history of ${inconsistency.tableId} does not extend its Head history`;
}
