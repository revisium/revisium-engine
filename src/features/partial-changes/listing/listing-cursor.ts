import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import {
  UNIT_KINDS,
  type Unit,
} from 'src/features/partial-changes/catalogue/unit';
import { ListingValidationError } from 'src/features/partial-changes/listing/listing-validation-error';
import type { RowBound } from 'src/features/partial-changes/snapshot/changes-snapshot';

export type ListedPosition = Pick<CatalogueUnit, 'key' | 'unit'>;

export interface ListingCursor {
  readonly last: ListedPosition;
  readonly rows?: RowBound;
}

interface CursorPayload extends ListingCursor {
  readonly v: number;
}

type Fields = Readonly<Record<string, unknown>>;

const CURSOR_VERSION = 1;
const BASE64URL = /^[\w-]+$/;
const UNIT_KIND_NAMES: ReadonlySet<unknown> = new Set(UNIT_KINDS);
const OPTIONAL_SORT_PARTS = [
  'rowId',
  'path',
  'previousTableId',
  'previousRowId',
] as const;

export function encodeListingCursor({ last, rows }: ListingCursor): string {
  const payload: CursorPayload = {
    v: CURSOR_VERSION,
    last: { key: last.key, unit: sortKeyOf(last.unit) },
    rows,
  };

  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeListingCursor(text: string): ListingCursor {
  const payload = payloadOf(text);

  if (!isCursorPayload(payload)) {
    throw malformedCursor();
  }

  const { last, rows } = payload;

  return { last, rows };
}

function sortKeyOf({
  kind,
  tableId,
  rowId,
  path,
  previousTableId,
  previousRowId,
}: Unit): Unit {
  return { kind, tableId, rowId, path, previousTableId, previousRowId };
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

function isCursorPayload(value: unknown): value is CursorPayload {
  return (
    isFields(value) &&
    value.v === CURSOR_VERSION &&
    isPosition(value.last) &&
    (value.rows === undefined || isRowBoundOf(value.rows, value.last))
  );
}

function isPosition(value: unknown): value is ListedPosition {
  return isFields(value) && typeof value.key === 'string' && isUnit(value.unit);
}

function isUnit(value: unknown): value is Unit {
  return (
    isFields(value) &&
    UNIT_KIND_NAMES.has(value.kind) &&
    typeof value.tableId === 'string' &&
    OPTIONAL_SORT_PARTS.every((part) => isOptionalText(value[part]))
  );
}

function isRowBoundOf(value: unknown, { unit }: ListedPosition): boolean {
  return (
    isFields(value) &&
    value.rowId === unit.rowId &&
    typeof value.rowId === 'string' &&
    typeof value.inclusive === 'boolean'
  );
}

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalText(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function malformedCursor(): ListingValidationError {
  return new ListingValidationError('cursor is malformed');
}
