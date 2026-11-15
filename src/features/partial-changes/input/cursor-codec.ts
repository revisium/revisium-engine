import {
  type Fields,
  hasOnlyFields,
  isFields,
} from 'src/features/partial-changes/input/fields';

// One kind per operation that issues cursors: an operation accepts only its own.
// The row read issues one kind per order, so a cursor of one order is refused under the other.
export type CursorKind = 'tables' | 'rows' | 'recentRows';

// Bounds the work spent on any cursor text, far above the longest cursor issued: a row position of two ids.
export const MAX_CURSOR_LENGTH = 16_384;

// Bounds the work of reading a payload; an issued cursor holds only texts and flags.
const MAX_NESTING = 3;
const CURSOR_VERSION = 2;
const BASE64URL = /^[\w-]+$/;
const ENVELOPE_FIELDS = ['v', 'kind'] as const;

export function encodeCursor(kind: CursorKind, parts: Fields): string {
  const payload = { v: CURSOR_VERSION, kind, ...parts };

  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

// The parts of a cursor of this kind, or undefined for a text that is not one.
export function cursorPartsOf(
  text: string,
  kind: CursorKind,
  partNames: ReadonlySet<string>,
): Fields | undefined {
  const payload = payloadOf(text);

  if (
    !isFields(payload) ||
    payload.v !== CURSOR_VERSION ||
    payload.kind !== kind ||
    !hasOnlyFields(payload, new Set([...ENVELOPE_FIELDS, ...partNames])) ||
    !isShallowWithoutNul(payload)
  ) {
    return undefined;
  }

  return payload;
}

function payloadOf(text: string): unknown {
  if (text.length > MAX_CURSOR_LENGTH || !BASE64URL.test(text)) {
    return undefined;
  }

  try {
    return JSON.parse(Buffer.from(text, 'base64url').toString());
  } catch {
    return undefined;
  }
}

// Level by level, so no payload can exhaust the stack. No id holds the NUL character, and a database text parameter
// cannot.
function isShallowWithoutNul(payload: Fields): boolean {
  let level: readonly object[] = [payload];

  for (let depth = 1; depth <= MAX_NESTING; depth += 1) {
    const parts = level.flatMap((value) => Object.values(value));

    if (parts.some(isTextWithNul)) {
      return false;
    }

    level = parts.filter(isObject);
  }

  return level.length === 0;
}

function isTextWithNul(value: unknown): boolean {
  return typeof value === 'string' && value.includes('\u0000');
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}
