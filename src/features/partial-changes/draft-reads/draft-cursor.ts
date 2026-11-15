import {
  cursorPartsOf,
  encodeCursor,
} from 'src/features/partial-changes/input/cursor-codec';
import type { Fields } from 'src/features/partial-changes/input/fields';
import { ListingValidationError } from 'src/features/partial-changes/draft-reads/listing-validation-error';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';

// Of two items with one table id, the table that exists only in Head comes first.
export interface TablePosition {
  readonly tableId: string;
  readonly headOnly: boolean;
}

// The last row id of a page: every item of one row id is on the same page.
export interface RowPosition {
  readonly table: TablePosition;
  readonly rowId: string;
}

// The last line of a page in the recent order: its time (null for a removed row) and its row id.
export interface RecentRowPosition extends RowPosition {
  readonly changedAt: string | null;
}

const CHANGE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const FIRST_STORED_YEAR = 1;
const TABLE_CURSOR_PARTS: ReadonlySet<string> = new Set([
  'tableId',
  'headOnly',
]);
const ROW_CURSOR_PARTS: ReadonlySet<string> = new Set([
  ...TABLE_CURSOR_PARTS,
  'rowId',
]);
const RECENT_ROW_CURSOR_PARTS: ReadonlySet<string> = new Set([
  ...ROW_CURSOR_PARTS,
  'changedAt',
]);

export function compareTablePositions(
  left: TablePosition,
  right: TablePosition,
): number {
  return (
    compareCodePoints(left.tableId, right.tableId) ||
    Number(right.headOnly) - Number(left.headOnly)
  );
}

export function encodeTableCursor({
  tableId,
  headOnly,
}: TablePosition): string {
  return encodeCursor('tables', { tableId, headOnly });
}

export function decodeTableCursor(text: string): TablePosition {
  const parts = cursorPartsOf(text, 'tables', TABLE_CURSOR_PARTS);

  if (!parts || !isTablePosition(parts)) {
    throw malformedCursor();
  }

  return { tableId: parts.tableId, headOnly: parts.headOnly };
}

export function encodeRowCursor({ table, rowId }: RowPosition): string {
  return encodeCursor('rows', {
    tableId: table.tableId,
    headOnly: table.headOnly,
    rowId,
  });
}

export function decodeRowCursor(text: string): RowPosition {
  const parts = cursorPartsOf(text, 'rows', ROW_CURSOR_PARTS);

  if (!parts || !isTablePosition(parts) || typeof parts.rowId !== 'string') {
    throw malformedCursor();
  }

  return {
    table: { tableId: parts.tableId, headOnly: parts.headOnly },
    rowId: parts.rowId,
  };
}

export function encodeRecentRowCursor({
  table,
  rowId,
  changedAt,
}: RecentRowPosition): string {
  return encodeCursor('recentRows', {
    tableId: table.tableId,
    headOnly: table.headOnly,
    rowId,
    changedAt,
  });
}

export function decodeRecentRowCursor(text: string): RecentRowPosition {
  const parts = cursorPartsOf(text, 'recentRows', RECENT_ROW_CURSOR_PARTS);

  if (
    !parts ||
    !isTablePosition(parts) ||
    typeof parts.rowId !== 'string' ||
    !isChangeTime(parts.changedAt)
  ) {
    throw malformedCursor();
  }

  return {
    table: { tableId: parts.tableId, headOnly: parts.headOnly },
    rowId: parts.rowId,
    changedAt: parts.changedAt,
  };
}

// A time as the read issues it, in UTC to the millisecond, or null for a removed row: a real calendar time that the
// database timestamp holds. It has no year 0, and four digits stay far below its last year.
function isChangeTime(value: unknown): value is string | null {
  if (value === null) {
    return true;
  }

  if (typeof value !== 'string' || !CHANGE_TIME.test(value)) {
    return false;
  }

  const time = new Date(value);

  return (
    !Number.isNaN(time.getTime()) &&
    time.toISOString() === value &&
    time.getUTCFullYear() >= FIRST_STORED_YEAR
  );
}

function isTablePosition(parts: Fields): parts is Fields & TablePosition {
  return (
    typeof parts.tableId === 'string' && typeof parts.headOnly === 'boolean'
  );
}

function malformedCursor(): ListingValidationError {
  return new ListingValidationError(
    'after is malformed: pass the endCursor of the previous page',
  );
}
