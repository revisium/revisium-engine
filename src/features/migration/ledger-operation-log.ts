import type { SchemaLedgerBackfill } from 'src/features/migration/commands/impl/backfill-schema-ledger.command';
import type { SchemaLedgerRepair } from 'src/features/migration/commands/impl/repair-schema-ledger.command';
import type {
  LogFields,
  TrackedOperation,
} from 'src/infrastructure/database/operation-log';

export type LedgerOperation = 'backfill' | 'repair';

export const LEDGER_OPERATION_FINISHED = 'Schema ledger operation finished';

export function ledgerOperation(
  operation: LedgerOperation,
  input: unknown,
): TrackedOperation {
  return { operation, message: LEDGER_OPERATION_FINISHED, branch: input };
}

// The ids and counts of a backfill's result.
export function backfillFieldsOf(backfill: SchemaLedgerBackfill): LogFields {
  const { headRevisionId, draftRevisionId } = backfill;

  if (backfill.status === 'backfilled') {
    return {
      previousHeadRevisionId: backfill.previousHeadRevisionId,
      headRevisionId,
      draftRevisionId,
      entries: backfill.entries.length,
    };
  }

  if (backfill.status === 'planned') {
    return {
      headRevisionId,
      draftRevisionId,
      entries: backfill.entries.length,
    };
  }

  return { headRevisionId, draftRevisionId };
}

// A repair result has no status.
export function repairOutcomeOf(
  repair: SchemaLedgerRepair,
  written: boolean,
): string {
  if (written) {
    return 'repaired';
  }

  if (repair.dryRun) {
    return 'planned';
  }

  if (repair.tables.some(({ outcome }) => outcome === 'stale')) {
    return 'stale';
  }

  return 'unchanged';
}

// The ids and counts of a repair's result.
export function repairFieldsOf({
  headRevisionId,
  draftRevisionId,
  tables,
  renumbered,
}: SchemaLedgerRepair): LogFields {
  return {
    headRevisionId,
    draftRevisionId,
    tables: tables.length,
    repairedTables: tables.filter(({ outcome }) => outcome === 'repaired')
      .length,
    renumbered: renumbered.length,
  };
}
