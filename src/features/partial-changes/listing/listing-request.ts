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
  pageSize = DEFAULT_PAGE_SIZE,
}: ListChangesInput): ListingRequest {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new ListingValidationError(
      `pageSize must be an integer from 1 to ${MAX_PAGE_SIZE}`,
    );
  }

  return { branch, tableId, cursor: decodedCursorOf(cursor), pageSize };
}

function decodedCursorOf(
  cursor: string | undefined,
): ListingCursor | undefined {
  if (cursor === undefined) {
    return undefined;
  }

  return decodeListingCursor(cursor);
}
