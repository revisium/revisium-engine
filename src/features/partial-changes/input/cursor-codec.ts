import {
  type Fields,
  hasOnlyFields,
  isFields,
} from 'src/features/partial-changes/input/fields';

// One kind per operation that issues cursors: an operation accepts only its own.
export type CursorKind = 'units' | 'tables' | 'rows';

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
    holdsNul(payload)
  ) {
    return undefined;
  }

  return payload;
}

function payloadOf(text: string): unknown {
  if (!BASE64URL.test(text)) {
    return undefined;
  }

  try {
    return JSON.parse(Buffer.from(text, 'base64url').toString());
  } catch {
    return undefined;
  }
}

// No id holds the NUL character, and a database text parameter cannot.
function holdsNul(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.includes('\u0000');
  }

  if (typeof value === 'object' && value !== null) {
    return Object.values(value).some(holdsNul);
  }

  return false;
}
