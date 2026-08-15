import { BadRequestException } from '@nestjs/common';

// Revision.sequence is a PostgreSQL integer; an unbounded client-supplied
// value would fail the ::integer cast with a 500 instead of a 400.
const MAX_SEQUENCE = 2147483647;

/**
 * Opaque position within one exact logical-row history stream, keyed by the
 * event Revision and its global sequence. The decoder accepts exactly this
 * shape — any cursor from a different build of the payload is rejected.
 */
export type PreviousRowStatesCursor = {
  readonly tipRevisionId: string;
  readonly tableCreatedId: string;
  readonly rowCreatedId: string;
  readonly eventRevisionId: string;
  readonly sequence: number;
};

const CURSOR_KEYS = [
  'eventRevisionId',
  'rowCreatedId',
  'sequence',
  'tableCreatedId',
  'tipRevisionId',
];

export function encodePreviousRowStatesCursor(
  cursor: PreviousRowStatesCursor,
): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodePreviousRowStatesCursor(
  value: string,
): PreviousRowStatesCursor {
  try {
    if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
      throw new Error('invalid base64url');
    }

    const decoded: unknown = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    );
    if (!isCursor(decoded)) {
      throw new Error('invalid cursor payload');
    }

    return decoded;
  } catch (error) {
    throw new BadRequestException('Invalid previous row states cursor', {
      cause: error,
    });
  }
}

function isCursor(value: unknown): value is PreviousRowStatesCursor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const cursor = value as Record<string, unknown>;
  const keys = Object.keys(cursor).sort();
  return (
    keys.length === CURSOR_KEYS.length &&
    keys.every((key, index) => key === CURSOR_KEYS[index]) &&
    isNonEmptyString(cursor.tipRevisionId) &&
    isNonEmptyString(cursor.tableCreatedId) &&
    isNonEmptyString(cursor.rowCreatedId) &&
    isNonEmptyString(cursor.eventRevisionId) &&
    Number.isInteger(cursor.sequence) &&
    (cursor.sequence as number) > 0 &&
    (cursor.sequence as number) <= MAX_SEQUENCE
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
