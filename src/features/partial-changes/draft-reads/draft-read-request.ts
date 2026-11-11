import {
  decodeRowCursor,
  decodeTableCursor,
  type RowPosition,
  type TablePosition,
} from 'src/features/partial-changes/draft-reads/draft-cursor';
import { ListingValidationError } from 'src/features/partial-changes/listing/listing-validation-error';
import type { DraftChangesSummaryInput } from 'src/features/partial-changes/queries/impl/get-draft-changes-summary.query';
import type { DraftRowChangesInput } from 'src/features/partial-changes/queries/impl/get-draft-row-changes.query';
import type { DraftTableChangesInput } from 'src/features/partial-changes/queries/impl/get-draft-table-changes.query';
import type { ChangesBranch } from 'src/features/partial-changes/snapshot/changes-snapshot';
import { ChangeType } from 'src/features/revision-changes/types';

export interface TableFilters {
  readonly changeTypes?: readonly ChangeType[];
  readonly search?: string;
}

export interface RowFilters extends TableFilters {
  readonly tableId?: string;
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
}

export interface DraftChangesSummaryRequest {
  readonly branch: ChangesBranch;
  readonly filters: TableFilters;
}

type Fields = Readonly<Record<string, unknown>>;

const MAX_PAGE_SIZE = 5_000;
const CHANGE_TYPES: ReadonlySet<unknown> = new Set(Object.values(ChangeType));
const FILTER_NAMES: readonly (keyof RowFilters)[] = [
  'changeTypes',
  'search',
  'tableId',
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
}: DraftRowChangesInput): DraftRowChangesRequest {
  return {
    branch,
    first: pageSizeOf(first),
    after: cursorOf(after, decodeRowCursor),
    filters: rowFiltersOf(filters),
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

function tableFiltersOf(filters: unknown): TableFilters {
  return tableFiltersOfFields(filterFieldsOf(filters));
}

function rowFiltersOf(filters: unknown): RowFilters {
  const fields = filterFieldsOf(filters);

  return {
    ...tableFiltersOfFields(fields),
    tableId: tableIdOf(fields.tableId),
  };
}

function tableFiltersOfFields(fields: Fields): TableFilters {
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

function changeTypesOf(changeTypes: unknown): ChangeType[] | undefined {
  if (changeTypes === undefined || changeTypes === null) {
    return undefined;
  }

  if (!Array.isArray(changeTypes) || !changeTypes.every(isChangeType)) {
    throw new ListingValidationError(
      `filters.changeTypes must be an array of ${[...CHANGE_TYPES].join(', ')}`,
    );
  }

  return changeTypes;
}

function searchOf(search: unknown): string | undefined {
  if (search === undefined || search === null) {
    return undefined;
  }

  if (typeof search !== 'string') {
    throw new ListingValidationError('filters.search must be a string');
  }

  // No id holds it, and a database text parameter cannot.
  if (search.includes('\u0000')) {
    throw new ListingValidationError(
      'filters.search must not contain the NUL character',
    );
  }

  return search;
}

function isChangeType(value: unknown): value is ChangeType {
  return CHANGE_TYPES.has(value);
}

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
