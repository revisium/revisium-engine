import type { BackfillRefusal } from 'src/features/migration/commands/impl/backfill-schema-ledger.command';
import type { TableFailure } from './head-table-schemas';

export function draftStructureChanged(
  tableIds: readonly string[],
): BackfillRefusal {
  return {
    code: 'draftStructureChanged',
    tableIds,
    message:
      `The Draft changes the structure of ${quoted(tableIds)} without a ledger; ` +
      'commit or revert those changes natively, then run again',
  };
}

export function unreproducibleSchemas(
  failures: readonly TableFailure[],
): BackfillRefusal {
  const tableIds = failures.map(({ tableId }) => tableId);
  const reasons = failures
    .map(({ tableId, error }) => `"${tableId}": ${error}`)
    .join('; ');

  return {
    code: 'schemaNotReproducible',
    tableIds,
    message:
      `The ledger cannot reproduce the Head schemas of ${quoted(tableIds)} (${reasons}); ` +
      'fix them natively and commit, then run again',
  };
}

export function unsplittableCycles(
  tableIds: readonly string[],
): BackfillRefusal {
  return {
    code: 'schemaNotReproducible',
    tableIds,
    message:
      `No table of the foreign-key cycles of ${quoted(tableIds)} keeps its Head schema when split; ` +
      'update one table of each cycle natively (which resets its field defaults) ' +
      'or remove one foreign key of each cycle, commit, then run again',
  };
}

function quoted(tableIds: readonly string[]): string {
  return tableIds.map((tableId) => `"${tableId}"`).join(', ');
}
