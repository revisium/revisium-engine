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

interface TableCursorPayload {
  readonly v: number;
  readonly tableId: string;
  readonly headOnly: boolean;
}

interface RowCursorPayload extends TableCursorPayload {
  readonly rowId: string;
}

type Fields = Readonly<Record<string, unknown>>;

const CURSOR_VERSION = 1;
const BASE64URL = /^[\w-]+$/;
const TABLE_CURSOR_FIELDS: ReadonlySet<string> = new Set([
  'v',
  'tableId',
  'headOnly',
]);
const ROW_CURSOR_FIELDS: ReadonlySet<string> = new Set([
  ...TABLE_CURSOR_FIELDS,
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
  const payload: TableCursorPayload = { v: CURSOR_VERSION, tableId, headOnly };

  return encoded(payload);
}

export function decodeTableCursor(text: string): TablePosition {
  const payload = payloadOf(text);

  if (!isTableCursorPayload(payload)) {
    throw malformedCursor();
  }

  return { tableId: payload.tableId, headOnly: payload.headOnly };
}

export function encodeRowCursor({ table, rowId }: RowPosition): string {
  const payload: RowCursorPayload = {
    v: CURSOR_VERSION,
    tableId: table.tableId,
    headOnly: table.headOnly,
    rowId,
  };

  return encoded(payload);
}

export function decodeRowCursor(text: string): RowPosition {
  const payload = payloadOf(text);

  if (!isRowCursorPayload(payload)) {
    throw malformedCursor();
  }

  return {
    table: { tableId: payload.tableId, headOnly: payload.headOnly },
    rowId: payload.rowId,
  };
}

function encoded(payload: TableCursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function payloadOf(text: string): unknown {
  if (!BASE64URL.test(text)) {
    throw malformedCursor();
  }

  try {
    return JSON.parse(Buffer.from(text, 'base64url').toString());
  } catch {
    throw malformedCursor();
  }
}

function isTableCursorPayload(value: unknown): value is TableCursorPayload {
  return (
    isFields(value) &&
    hasOnlyFields(value, TABLE_CURSOR_FIELDS) &&
    hasTablePosition(value)
  );
}

function isRowCursorPayload(value: unknown): value is RowCursorPayload {
  return (
    isFields(value) &&
    hasOnlyFields(value, ROW_CURSOR_FIELDS) &&
    hasTablePosition(value) &&
    typeof value.rowId === 'string'
  );
}

function hasOnlyFields(value: Fields, fields: ReadonlySet<string>): boolean {
  return Object.keys(value).every((field) => fields.has(field));
}

function hasTablePosition(value: Fields): boolean {
  return (
    value.v === CURSOR_VERSION &&
    typeof value.tableId === 'string' &&
    typeof value.headOnly === 'boolean'
  );
}

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function malformedCursor(): ListingValidationError {
  return new ListingValidationError(
    'after is malformed: pass the endCursor of the previous page',
  );
}
