import {
  decodeListingCursor,
  type ListingCursor,
} from 'src/features/partial-changes/listing/listing-cursor';
import { ListingValidationError } from 'src/features/partial-changes/listing/listing-validation-error';
import type { ListChangesInput } from 'src/features/partial-changes/queries/impl/list-draft-changes.query';
import type { ChangesBranch } from 'src/features/partial-changes/snapshot/changes-snapshot';

export interface ListingRequest {
  readonly branch: ChangesBranch;
  readonly tableId?: string;
  readonly cursor?: ListingCursor;
  readonly pageSize: number;
}

const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGE_SIZE = 5_000;

export function listingRequestOf({
  branch,
  tableId,
  cursor,
  pageSize,
}: ListChangesInput): ListingRequest {
  return {
    branch,
    tableId: tableIdOf(tableId),
    cursor: cursorOf(cursor),
    pageSize: pageSizeOf(pageSize),
  };
}

function tableIdOf(tableId: unknown): string | undefined {
  if (tableId === undefined || tableId === null) {
    return undefined;
  }

  if (typeof tableId !== 'string') {
    throw new ListingValidationError('tableId must be a string');
  }

  return tableId;
}

function cursorOf(cursor: unknown): ListingCursor | undefined {
  if (cursor === undefined || cursor === null) {
    return undefined;
  }

  if (typeof cursor !== 'string') {
    throw new ListingValidationError('cursor must be a string');
  }

  return decodeListingCursor(cursor);
}

function pageSizeOf(pageSize: unknown): number {
  if (pageSize === undefined || pageSize === null) {
    return DEFAULT_PAGE_SIZE;
  }

  if (
    typeof pageSize !== 'number' ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > MAX_PAGE_SIZE
  ) {
    throw new ListingValidationError(
      `pageSize must be an integer from 1 to ${MAX_PAGE_SIZE}`,
    );
  }

  return pageSize;
}
