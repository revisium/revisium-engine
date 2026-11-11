import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import {
  UNIT_KINDS,
  type UnitAddress,
} from 'src/features/partial-changes/catalogue/unit';
import {
  cursorPartsOf,
  encodeCursor,
} from 'src/features/partial-changes/input/cursor-codec';
import {
  type Fields,
  hasOnlyFields,
  isFields,
} from 'src/features/partial-changes/input/fields';
import { ListingValidationError } from 'src/features/partial-changes/listing/listing-validation-error';
import type { RowBound } from 'src/features/partial-changes/snapshot/changes-snapshot';

export type ListedPosition = Pick<CatalogueUnit, 'key' | 'unit'>;

export interface ListingCursor {
  readonly tableId: string;
  readonly rows?: RowBound;
  readonly last?: ListedPosition;
}

const UNIT_KIND_NAMES: ReadonlySet<unknown> = new Set(UNIT_KINDS);
const OPTIONAL_SORT_PARTS = [
  'rowId',
  'path',
  'previousTableId',
  'previousRowId',
] as const;
const CURSOR_PARTS: ReadonlySet<string> = new Set(['tableId', 'rows', 'last']);
const ROW_BOUND_PARTS: ReadonlySet<string> = new Set(['rowId', 'inclusive']);
const POSITION_PARTS: ReadonlySet<string> = new Set(['key', 'unit']);
const UNIT_ADDRESS_PARTS: ReadonlySet<string> = new Set([
  'kind',
  'tableId',
  ...OPTIONAL_SORT_PARTS,
]);

export function encodeListingCursor({
  tableId,
  rows,
  last,
}: ListingCursor): string {
  return encodeCursor('units', {
    tableId,
    rows,
    last: sortKeyPositionOf(last),
  });
}

export function decodeListingCursor(text: string): ListingCursor {
  const parts = cursorPartsOf(text, 'units', CURSOR_PARTS);

  if (!parts || !isListingCursor(parts)) {
    throw malformedCursor();
  }

  const { tableId, rows, last } = parts;

  return { tableId, rows, last };
}

function sortKeyPositionOf(
  position: ListedPosition | undefined,
): ListedPosition | undefined {
  if (!position) {
    return undefined;
  }

  return { key: position.key, unit: sortKeyOf(position.unit) };
}

function sortKeyOf({
  kind,
  tableId,
  rowId,
  path,
  previousTableId,
  previousRowId,
}: UnitAddress): UnitAddress {
  return { kind, tableId, rowId, path, previousTableId, previousRowId };
}

function isListingCursor(parts: Fields): parts is Fields & ListingCursor {
  return (
    typeof parts.tableId === 'string' &&
    (parts.rows === undefined || isRowBound(parts.rows)) &&
    (parts.last === undefined || isPosition(parts.last))
  );
}

function isPosition(value: unknown): value is ListedPosition {
  return (
    isFields(value) &&
    hasOnlyFields(value, POSITION_PARTS) &&
    typeof value.key === 'string' &&
    isUnitAddress(value.unit)
  );
}

function isUnitAddress(value: unknown): value is UnitAddress {
  return (
    isFields(value) &&
    hasOnlyFields(value, UNIT_ADDRESS_PARTS) &&
    UNIT_KIND_NAMES.has(value.kind) &&
    typeof value.tableId === 'string' &&
    OPTIONAL_SORT_PARTS.every((part) => isOptionalText(value[part]))
  );
}

function isRowBound(value: unknown): value is RowBound {
  return (
    isFields(value) &&
    hasOnlyFields(value, ROW_BOUND_PARTS) &&
    typeof value.rowId === 'string' &&
    typeof value.inclusive === 'boolean'
  );
}

function isOptionalText(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function malformedCursor(): ListingValidationError {
  return new ListingValidationError('cursor is malformed');
}
