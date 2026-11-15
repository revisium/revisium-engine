import { createHash } from 'crypto';
import type { DraftValueCut } from 'src/features/partial-changes/queries/impl/get-draft-row-changes.query';

// A side of a field change as a row read under a byte limit returns it.
export interface LimitedValue extends MeasuredValue {
  readonly value: unknown;
  readonly cut?: DraftValueCut;
}

// The size of a whole value and the token of its content.
export interface MeasuredValue {
  readonly bytes: number;
  readonly token: string;
}

// The part of a text from an offset that a range returns.
export interface TextSlice {
  readonly offset: number;
  readonly text: string;
}

const HALVES = 2;

// The UTF-8 bytes of the compact JSON text of a value.
export function jsonBytesOf(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

// The size of a value's compact JSON text, and the SHA-256 of that text as its token: equal values have one token, so a
// client that continues a string tells by the token whether it still reads the value it started.
export function measuredValueOf(value: unknown): MeasuredValue {
  const text = JSON.stringify(value);

  return {
    bytes: Buffer.byteLength(text, 'utf8'),
    token: createHash('sha256').update(text).digest('base64url'),
  };
}

// A value over the limit: a string as its longest prefix of whole characters whose JSON text fits the limit; any other
// value as null, since a part of it is no JSON value.
export function cutValueOf(value: unknown, maxBytes: number): LimitedValue {
  const measured = measuredValueOf(value);

  if (measured.bytes <= maxBytes) {
    return { value, ...measured };
  }

  if (typeof value !== 'string') {
    return { value: null, ...measured, cut: 'omitted' };
  }

  return { value: prefixWithin(value, maxBytes), ...measured, cut: 'prefix' };
}

// The code units from offset up to limit, moved to whole characters: the slice starts at the surrogate pair its offset
// falls into, ends before the pair its end would split, and holds a whole pair when it would otherwise be empty.
export function textSliceOf(
  text: string,
  offset: number,
  limit: number | undefined,
): TextSlice {
  const start = characterStartAt(text, Math.min(offset, text.length));
  const requestedEnd = Math.min(
    limit === undefined ? text.length : offset + limit,
    text.length,
  );
  let end = characterStartAt(text, Math.max(requestedEnd, start));

  if (end === start && requestedEnd > start) {
    end = start + characterLengthAt(text, start);
  }

  return { offset: start, text: text.slice(start, end) };
}

// Each code unit takes at least one byte, so the prefix holds at most maxBytes of them; a binary search over the
// character boundaries finds the longest that fits, as the JSON text of a longer prefix is never shorter.
function prefixWithin(text: string, maxBytes: number): string {
  let fits = 0;
  let exceeds = Math.min(text.length, maxBytes) + 1;

  while (exceeds - fits > 1) {
    const middle = fits + Math.floor((exceeds - fits) / HALVES);

    if (jsonBytesOf(prefixAt(text, middle)) <= maxBytes) {
      fits = middle;
    } else {
      exceeds = middle;
    }
  }

  return prefixAt(text, fits);
}

// The prefix up to the position, without the first half of a surrogate pair the position would split.
function prefixAt(text: string, position: number): string {
  return text.slice(0, characterStartAt(text, position));
}

// The position itself, or one before it when it falls between the two halves of a surrogate pair.
function characterStartAt(text: string, position: number): number {
  if (position > 0 && position < text.length && isPairAt(text, position - 1)) {
    return position - 1;
  }

  return position;
}

// The code units of the character at the position: two for a surrogate pair.
function characterLengthAt(text: string, position: number): number {
  return String.fromCodePoint(text.codePointAt(position) ?? 0).length;
}

function isPairAt(text: string, position: number): boolean {
  return characterLengthAt(text, position) > 1;
}
