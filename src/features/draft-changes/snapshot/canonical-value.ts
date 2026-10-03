import { isDate } from 'node:util/types';

export function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

export function canonicalValue(value: unknown): unknown {
  if (value === null) {
    return ['null'];
  }
  if (typeof value === 'object' && value !== null && isDate(value)) {
    return ['date', Date.prototype.toISOString.call(value)];
  }
  if (typeof value === 'bigint') {
    return ['bigint', value.toString()];
  }
  if (typeof value === 'string') {
    return ['string', value];
  }
  if (typeof value === 'boolean') {
    return ['boolean', value];
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Snapshot fingerprints require finite numbers.');
    }
    return ['number', Object.is(value, -0) ? '-0' : value.toString()];
  }
  if (Array.isArray(value)) {
    return ['array', value.map(canonicalValue)];
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([key, entry]) => [key, canonicalValue(entry)]);
    return ['object', entries];
  }
  throw new TypeError(
    `Unsupported snapshot fingerprint value: ${typeof value}`,
  );
}
