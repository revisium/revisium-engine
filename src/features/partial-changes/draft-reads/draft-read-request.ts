import {
  decodeRowCursor,
  decodeTableCursor,
  type RowPosition,
  type TablePosition,
} from 'src/features/partial-changes/draft-reads/draft-cursor';
import {
  type Fields,
  isFields,
} from 'src/features/partial-changes/input/fields';
import { ListingValidationError } from 'src/features/partial-changes/draft-reads/listing-validation-error';
import type { DraftChangesSummaryInput } from 'src/features/partial-changes/queries/impl/get-draft-changes-summary.query';
import {
  DRAFT_ROW_CHANGE_KINDS,
  type DraftRowChangeKind,
  type DraftRowChangesInput,
} from 'src/features/partial-changes/queries/impl/get-draft-row-changes.query';
import type { DraftTableChangesInput } from 'src/features/partial-changes/queries/impl/get-draft-table-changes.query';
import type { ChangesBranch } from 'src/features/partial-changes/snapshot/changes-snapshot';
import { ChangeType } from 'src/features/revision-changes/types';

export interface TableFilters {
  readonly changeTypes?: readonly ChangeType[];
  readonly search?: string;
}

export interface RowFilters {
  readonly tableId?: string;
  readonly rowIds?: readonly string[];
  readonly changeTypes?: readonly DraftRowChangeKind[];
  readonly search?: string;
}

export interface DraftTableChangesRequest {
  readonly branch: ChangesBranch;
  readonly first: number;
  readonly after?: TablePosition;
  readonly filters: TableFilters;
}

export interface DraftRowChangesRequest {
  readonly branch: ChangesBranch;
  readonly first: number;
  readonly after?: RowPosition;
  readonly filters: RowFilters;
  readonly fieldsPerRow?: number;
}

export interface DraftChangesSummaryRequest {
  readonly branch: ChangesBranch;
  readonly filters: TableFilters;
}

const MAX_PAGE_SIZE = 5_000;
const MAX_FIELDS_PER_ROW = 1_000;
const MAX_ROW_IDS = 100;
const CHANGE_TYPES: ReadonlySet<unknown> = new Set(Object.values(ChangeType));
const ROW_CHANGE_KINDS: ReadonlySet<unknown> = new Set(DRAFT_ROW_CHANGE_KINDS);
const FILTER_NAMES: readonly (keyof RowFilters)[] = [
  'changeTypes',
  'search',
  'tableId',
  'rowIds',
];

export function tableChangesRequestOf({
  branch,
  first,
  after,
  filters,
}: DraftTableChangesInput): DraftTableChangesRequest {
  return {
    branch,
    first: pageSizeOf(first),
    after: cursorOf(after, decodeTableCursor),
    filters: tableFiltersOf(filters),
  };
}

export function rowChangesRequestOf({
  branch,
  first,
  after,
  filters,
  fieldsPerRow,
}: DraftRowChangesInput): DraftRowChangesRequest {
  return {
    branch,
    first: pageSizeOf(first),
    after: cursorOf(after, decodeRowCursor),
    filters: rowFiltersOf(filters),
    fieldsPerRow: fieldsPerRowOf(fieldsPerRow),
  };
}

export function summaryRequestOf({
  branch,
  filters,
}: DraftChangesSummaryInput): DraftChangesSummaryRequest {
  return { branch, filters: tableFiltersOf(filters) };
}

// The names of the filters a request applies, for its log entry.
export function presentFiltersOf(filters: RowFilters): string[] {
  return FILTER_NAMES.filter((name) => filters[name] !== undefined);
}

function pageSizeOf(first: unknown): number {
  if (
    typeof first !== 'number' ||
    !Number.isInteger(first) ||
    first < 1 ||
    first > MAX_PAGE_SIZE
  ) {
    throw new ListingValidationError(
      `first must be an integer from 1 to ${MAX_PAGE_SIZE}`,
    );
  }

  return first;
}

function fieldsPerRowOf(fieldsPerRow: unknown): number | undefined {
  if (fieldsPerRow === undefined || fieldsPerRow === null) {
    return undefined;
  }

  if (
    typeof fieldsPerRow !== 'number' ||
    !Number.isInteger(fieldsPerRow) ||
    fieldsPerRow < 0 ||
    fieldsPerRow > MAX_FIELDS_PER_ROW
  ) {
    throw new ListingValidationError(
      `fieldsPerRow must be an integer from 0 to ${MAX_FIELDS_PER_ROW}`,
    );
  }

  return fieldsPerRow;
}

function cursorOf<Position>(
  after: unknown,
  decode: (cursor: string) => Position,
): Position | undefined {
  if (after === undefined || after === null) {
    return undefined;
  }

  if (typeof after !== 'string') {
    throw new ListingValidationError('after must be a string');
  }

  return decode(after);
}

function rowFiltersOf(filters: unknown): RowFilters {
  const fields = filterFieldsOf(filters);
  const tableId = tableIdOf(fields.tableId);
  const rowIds = rowIdsOf(fields.rowIds);

  if (rowIds !== undefined && tableId === undefined) {
    throw new ListingValidationError('filters.rowIds requires filters.tableId');
  }

  return {
    tableId,
    rowIds,
    changeTypes: rowChangeKindsOf(fields.changeTypes),
    search: searchOf(fields.search),
  };
}

function tableFiltersOf(filters: unknown): TableFilters {
  const fields = filterFieldsOf(filters);

  return {
    changeTypes: changeTypesOf(fields.changeTypes),
    search: searchOf(fields.search),
  };
}

function filterFieldsOf(filters: unknown): Fields {
  if (filters === undefined || filters === null) {
    return {};
  }

  if (!isFields(filters)) {
    throw new ListingValidationError('filters must be an object');
  }

  return filters;
}

function tableIdOf(tableId: unknown): string | undefined {
  if (tableId === undefined || tableId === null) {
    return undefined;
  }

  if (typeof tableId !== 'string') {
    throw new ListingValidationError('filters.tableId must be a string');
  }

  return tableId;
}

function rowIdsOf(rowIds: unknown): string[] | undefined {
  if (rowIds === undefined || rowIds === null) {
    return undefined;
  }

  if (
    !Array.isArray(rowIds) ||
    !rowIds.every(isIdText) ||
    rowIds.length > MAX_ROW_IDS
  ) {
    throw new ListingValidationError(
      `filters.rowIds must be an array of at most ${MAX_ROW_IDS} strings without the NUL character`,
    );
  }

  return rowIds;
}

function changeTypesOf(changeTypes: unknown): ChangeType[] | undefined {
  return listOf(changeTypes, CHANGE_TYPES);
}

function rowChangeKindsOf(
  changeTypes: unknown,
): DraftRowChangeKind[] | undefined {
  return listOf(changeTypes, ROW_CHANGE_KINDS);
}

function listOf<Value>(
  values: unknown,
  allowed: ReadonlySet<unknown>,
): Value[] | undefined {
  if (values === undefined || values === null) {
    return undefined;
  }

  if (!Array.isArray(values) || !values.every((value) => allowed.has(value))) {
    throw new ListingValidationError(
      `filters.changeTypes must be an array of ${[...allowed].join(', ')}`,
    );
  }

  return values as Value[];
}

function searchOf(search: unknown): string | undefined {
  if (search === undefined || search === null) {
    return undefined;
  }

  if (typeof search !== 'string') {
    throw new ListingValidationError('filters.search must be a string');
  }

  if (!isIdText(search)) {
    throw new ListingValidationError(
      'filters.search must not contain the NUL character',
    );
  }

  return search;
}

// No id holds the NUL character, and a database text parameter cannot.
function isIdText(value: unknown): value is string {
  return typeof value === 'string' && !value.includes('\u0000');
}
