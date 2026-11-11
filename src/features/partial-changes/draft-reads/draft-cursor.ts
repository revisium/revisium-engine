import {
  cursorPartsOf,
  encodeCursor,
} from 'src/features/partial-changes/input/cursor-codec';
import type { Fields } from 'src/features/partial-changes/input/fields';
import { ListingValidationError } from 'src/features/partial-changes/listing/listing-validation-error';
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

const TABLE_CURSOR_PARTS: ReadonlySet<string> = new Set([
  'tableId',
  'headOnly',
]);
const ROW_CURSOR_PARTS: ReadonlySet<string> = new Set([
  ...TABLE_CURSOR_PARTS,
  'rowId',
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
