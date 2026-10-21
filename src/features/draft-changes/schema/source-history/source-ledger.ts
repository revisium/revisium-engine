import {
  deepEqual,
  type RevisiumValidator,
} from '@revisium/schema-toolkit/lib';
import type { Migration } from '@revisium/schema-toolkit/types';
import type { DraftChangesRevisionSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type { SourceHistoryBlocker } from 'src/features/draft-changes/schema/source-history/source-history.types';
import { compareStrings } from 'src/features/draft-changes/snapshot/canonical-value';
import { SystemTables } from 'src/features/share/system-tables.consts';

type LedgerRow = DraftChangesRevisionSnapshot['tables'][number]['rows'][number];

export type SourceLedgerResult =
  | { status: 'recorded'; pendingMigrations: Migration[] }
  | { status: 'unrecorded' }
  | { status: 'blocked'; blocker: SourceHistoryBlocker };

export function readSourceLedger(
  head: DraftChangesRevisionSnapshot,
  draft: DraftChangesRevisionSnapshot,
  validator: RevisiumValidator,
): SourceLedgerResult {
  const headRows = sortLedgerRows(findLedgerRows(head) ?? []);
  const draftRows = findLedgerRows(draft);
  if (!draftRows) {
    return readMissingDraftLedger(headRows);
  }

  const prefixBlocker = validateHeadPrefix(headRows, draftRows);
  if (prefixBlocker) {
    return { status: 'blocked', blocker: prefixBlocker };
  }

  return readPendingMigrations(headRows, draftRows, validator);
}

function findLedgerRows(
  revision: DraftChangesRevisionSnapshot,
): LedgerRow[] | undefined {
  const ledgerTables = revision.tables.filter(
    ({ id }) => id === SystemTables.Migration,
  );
  if (ledgerTables.length === 0) {
    return undefined;
  }
  return ledgerTables.flatMap(({ rows }) => rows);
}

function readMissingDraftLedger(headRows: LedgerRow[]): SourceLedgerResult {
  if (headRows.length === 0) {
    return { status: 'unrecorded' };
  }
  return blockedLedger(
    'Draft has no migration table while Head keeps ledger rows.',
  );
}

function validateHeadPrefix(
  headRows: LedgerRow[],
  draftRows: LedgerRow[],
): SourceHistoryBlocker | undefined {
  const draftRowsById = groupRowsById(draftRows);
  for (const headRow of headRows) {
    if (!isKeptInDraft(headRow, draftRowsById)) {
      return ledgerBlocker(
        `Head ledger row '${headRow.id}' is not kept unchanged in Draft.`,
      );
    }
  }
  return undefined;
}

function groupRowsById(rows: LedgerRow[]): Map<string, LedgerRow[]> {
  const rowsById = new Map<string, LedgerRow[]>();
  for (const row of rows) {
    const sameId = rowsById.get(row.id);
    if (sameId) {
      sameId.push(row);
    } else {
      rowsById.set(row.id, [row]);
    }
  }
  return rowsById;
}

function isKeptInDraft(
  headRow: LedgerRow,
  draftRowsById: Map<string, LedgerRow[]>,
): boolean {
  const matches = draftRowsById.get(headRow.id) ?? [];
  return matches.length === 1 && deepEqual(matches[0]?.data, headRow.data);
}

function readPendingMigrations(
  headRows: LedgerRow[],
  draftRows: LedgerRow[],
  validator: RevisiumValidator,
): SourceLedgerResult {
  const headIds = new Set(headRows.map(({ id }) => id));
  const pendingRows = sortLedgerRows(
    draftRows.filter(({ id }) => !headIds.has(id)),
  );
  const pendingMigrations: Migration[] = [];
  const earlierIds = new Set<string>();

  for (const [eventIndex, row] of pendingRows.entries()) {
    const problem = findPendingRowProblem(row, {
      previous: pendingRows[eventIndex - 1],
      earlierIds,
      validator,
    });
    if (problem) {
      return blockedLedger(
        `Pending ledger row '${row.id}' ${problem}.`,
        eventIndex,
      );
    }
    earlierIds.add(row.id);
    pendingMigrations.push(row.data as Migration);
  }

  return { status: 'recorded', pendingMigrations };
}

function findPendingRowProblem(
  row: LedgerRow,
  context: {
    previous: LedgerRow | undefined;
    earlierIds: ReadonlySet<string>;
    validator: RevisiumValidator;
  },
): string | undefined {
  if (!context.validator.validateMigrations(row.data)) {
    return 'is not a valid migration';
  }
  if ((row.data as Migration).id !== row.id) {
    return 'records a migration with another id';
  }
  if (context.earlierIds.has(row.id)) {
    return 'repeats the id of an earlier pending row';
  }
  const { previous } = context;
  if (previous && publishedAtOf(previous) === publishedAtOf(row)) {
    return `shares its publication instant with '${previous.id}'`;
  }
  return undefined;
}

function sortLedgerRows(rows: LedgerRow[]): LedgerRow[] {
  return [...rows].sort(
    (left, right) =>
      publishedAtOf(left) - publishedAtOf(right) ||
      compareStrings(left.id, right.id),
  );
}

function publishedAtOf(row: LedgerRow): number {
  return row.publishedAt.getTime();
}

function blockedLedger(
  message: string,
  eventIndex?: number,
): SourceLedgerResult {
  return { status: 'blocked', blocker: ledgerBlocker(message, eventIndex) };
}

function ledgerBlocker(
  message: string,
  eventIndex?: number,
): SourceHistoryBlocker {
  const blocker: SourceHistoryBlocker = {
    code: 'SOURCE_LEDGER_INVALID',
    message,
  };
  if (eventIndex !== undefined) {
    blocker.eventIndex = eventIndex;
  }
  return blocker;
}
