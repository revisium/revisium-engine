import { BadRequestException } from '@nestjs/common';
import type { DraftChangesPage } from 'src/features/draft-changes/reading/pagination-types';
import type { DraftChangesConnection } from 'src/features/draft-changes/reading/pagination-types';

export type DraftChangesCursorEndpoint = 'tables' | 'rows' | 'rowDetails';

export interface DraftChangesCursorScope {
  endpoint: DraftChangesCursorEndpoint;
  branchId: string;
  fingerprint: string;
  tableCreatedId: string | null;
  rowCreatedId: string | null;
}

interface DraftChangesCursor extends DraftChangesCursorScope {
  version: 1;
  position: number;
}

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;

export function paginate<T>(
  items: T[],
  page: DraftChangesPage | undefined,
  scope: DraftChangesCursorScope,
): DraftChangesConnection<T> {
  return paginateMap(items, page, scope, (item) => item);
}

export function paginateMap<T, U>(
  items: T[],
  page: DraftChangesPage | undefined,
  scope: DraftChangesCursorScope,
  map: (item: T) => U,
): DraftChangesConnection<U> {
  const first = page?.first ?? DEFAULT_PAGE_SIZE;
  validatePageSize(first);

  const start =
    page?.after !== undefined
      ? positionAfter(page.after, scope, items.length)
      : 0;
  const end = Math.min(start + first, items.length);
  const edges = items.slice(start, end).map((item, offset) => ({
    cursor: encodeCursor({ ...scope, version: 1, position: start + offset }),
    node: map(item),
  }));
  const lastEdge = edges[edges.length - 1];

  return {
    totalCount: items.length,
    edges,
    pageInfo: {
      hasNextPage: end < items.length,
      endCursor: lastEdge?.cursor ?? null,
    },
  };
}

function validatePageSize(first: number): void {
  if (!Number.isInteger(first) || first < 1 || first > MAX_PAGE_SIZE) {
    throw new BadRequestException(
      'Page size must be an integer from 1 to 100.',
    );
  }
}

function positionAfter(
  cursor: string,
  scope: DraftChangesCursorScope,
  itemCount: number,
): number {
  const decoded = decodeCursor(cursor);
  if (!decoded || !matchesScope(decoded, scope)) {
    throw new BadRequestException(
      'Cursor is malformed or outside this read scope.',
    );
  }
  if (decoded.position >= itemCount) {
    throw new BadRequestException(
      'Cursor position is outside the current result.',
    );
  }
  return decoded.position + 1;
}

function matchesScope(
  cursor: DraftChangesCursor,
  scope: DraftChangesCursorScope,
): boolean {
  return (
    cursor.endpoint === scope.endpoint &&
    cursor.branchId === scope.branchId &&
    cursor.fingerprint === scope.fingerprint &&
    cursor.tableCreatedId === scope.tableCreatedId &&
    cursor.rowCreatedId === scope.rowCreatedId
  );
}

function encodeCursor(cursor: DraftChangesCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(value: string): DraftChangesCursor | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return undefined;
  }
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    );
    return isDraftChangesCursor(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function isDraftChangesCursor(value: unknown): value is DraftChangesCursor {
  return (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    value.version === 1 &&
    'endpoint' in value &&
    (value.endpoint === 'tables' ||
      value.endpoint === 'rows' ||
      value.endpoint === 'rowDetails') &&
    'branchId' in value &&
    typeof value.branchId === 'string' &&
    'fingerprint' in value &&
    typeof value.fingerprint === 'string' &&
    'tableCreatedId' in value &&
    (typeof value.tableCreatedId === 'string' ||
      value.tableCreatedId === null) &&
    'rowCreatedId' in value &&
    (typeof value.rowCreatedId === 'string' || value.rowCreatedId === null) &&
    'position' in value &&
    typeof value.position === 'number' &&
    Number.isSafeInteger(value.position) &&
    value.position >= 0
  );
}
