import { ListingValidationError } from 'src/features/partial-changes/listing/listing-validation-error';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';

// Of two items with one table id, the table that exists only in Head comes first.
export interface TablePosition {
  readonly tableId: string;
  readonly headOnly: boolean;
}

interface CursorPayload {
  readonly v: number;
  readonly tableId: string;
  readonly headOnly: boolean;
}

type Fields = Readonly<Record<string, unknown>>;

const CURSOR_VERSION = 1;
const BASE64URL = /^[\w-]+$/;
const TABLE_CURSOR_FIELDS: ReadonlySet<string> = new Set([
  'v',
  'tableId',
  'headOnly',
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
  const payload: CursorPayload = { v: CURSOR_VERSION, tableId, headOnly };

  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeTableCursor(text: string): TablePosition {
  const payload = payloadOf(text);

  if (!isTableCursorPayload(payload)) {
    throw malformedCursor();
  }

  return { tableId: payload.tableId, headOnly: payload.headOnly };
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

function isTableCursorPayload(value: unknown): value is CursorPayload {
  return (
    isFields(value) &&
    Object.keys(value).every((field) => TABLE_CURSOR_FIELDS.has(field)) &&
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
