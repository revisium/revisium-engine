import { BadRequestException } from '@nestjs/common';
import type { GetPreviousRowStatesQueryData } from 'src/features/row/queries/impl/get-previous-row-states.query';
import {
  decodePreviousRowStatesCursor,
  type PreviousRowStatesCursorV1,
} from 'src/features/row/utils/previous-row-states-cursor';

const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 100;

export type ParsedPreviousRowStatesRequest = Omit<
  GetPreviousRowStatesQueryData,
  'after'
> & {
  readonly after: PreviousRowStatesCursorV1 | null;
};

export function parsePreviousRowStatesRequest(
  data: GetPreviousRowStatesQueryData,
): ParsedPreviousRowStatesRequest {
  validateFirst(data.first);
  const after =
    data.after !== undefined ? decodePreviousRowStatesCursor(data.after) : null;

  if (after && after.tipRevisionId !== data.revisionId) {
    throwPreviousRowStatesCursorScopeError();
  }

  return {
    revisionId: data.revisionId,
    tableId: data.tableId,
    rowId: data.rowId,
    first: data.first,
    after,
  };
}

export function throwPreviousRowStatesCursorScopeError(): never {
  throw new BadRequestException(
    'Previous row states cursor does not belong to this result',
  );
}

function validateFirst(first: number): void {
  if (
    !Number.isInteger(first) ||
    first < MIN_PAGE_SIZE ||
    first > MAX_PAGE_SIZE
  ) {
    throw new BadRequestException('first must be an integer from 1 to 100');
  }
}
