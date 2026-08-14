import { BadRequestException } from '@nestjs/common';

/** Opaque, versioned position within one exact logical-row history stream. */
export type PreviousRowStatesCursorV1 = {
  readonly v: 1;
  readonly tipRevisionId: string;
  readonly tableCreatedId: string;
  readonly rowCreatedId: string;
  readonly eventRevisionId: string;
  readonly depth: number;
};

const CURSOR_KEYS = [
  'depth',
  'eventRevisionId',
  'rowCreatedId',
  'tableCreatedId',
  'tipRevisionId',
  'v',
];

export function encodePreviousRowStatesCursor(
  cursor: PreviousRowStatesCursorV1,
): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodePreviousRowStatesCursor(
  value: string,
): PreviousRowStatesCursorV1 {
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

function isCursor(value: unknown): value is PreviousRowStatesCursorV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const cursor = value as Record<string, unknown>;
  const keys = Object.keys(cursor).sort();
  return (
    keys.length === CURSOR_KEYS.length &&
    keys.every((key, index) => key === CURSOR_KEYS[index]) &&
    cursor.v === 1 &&
    isNonEmptyString(cursor.tipRevisionId) &&
    isNonEmptyString(cursor.tableCreatedId) &&
    isNonEmptyString(cursor.rowCreatedId) &&
    isNonEmptyString(cursor.eventRevisionId) &&
    Number.isInteger(cursor.depth) &&
    (cursor.depth as number) > 0
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
