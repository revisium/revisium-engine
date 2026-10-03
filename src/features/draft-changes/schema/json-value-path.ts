import type { JsonValue } from '@revisium/schema-toolkit/types';

export const missingValue = Symbol('missing');
export type MaybeJson = JsonValue | typeof missingValue;

export function readJsonPath(root: JsonValue, path: string): MaybeJson {
  if (path === '') {
    return root;
  }
  const segments = path.split('/').slice(1).map(unescapePointer);
  let current: JsonValue = root;
  for (const segment of segments) {
    const next = readJsonChild(current, segment);
    if (next === missingValue) {
      return missingValue;
    }
    current = next;
  }
  return current;
}

function readJsonChild(current: JsonValue, segment: string): MaybeJson {
  if (Array.isArray(current)) {
    const index = Number(segment);
    if (!Number.isInteger(index) || index < 0 || index >= current.length) {
      return missingValue;
    }
    const item = current[index];
    return item === undefined ? missingValue : item;
  }
  if (
    isObject(current) &&
    Object.prototype.hasOwnProperty.call(current, segment)
  ) {
    const item = current[segment];
    return item === undefined ? missingValue : item;
  }
  return missingValue;
}

export function setJsonPath(
  root: JsonValue,
  path: string,
  value: MaybeJson,
): { representable: boolean; value: JsonValue } {
  if (path === '') {
    return value === missingValue
      ? { representable: false, value: root }
      : { representable: true, value: structuredClone(value) };
  }
  const segments = path.split('/').slice(1).map(unescapePointer);
  const copy = structuredClone(root);
  const parent = getParent(copy, segments);
  if (!parent) {
    return { representable: false, value: root };
  }
  const final = segments[segments.length - 1];
  if (final === undefined) {
    return { representable: false, value: root };
  }
  if (Array.isArray(parent.value)) {
    const index = Number(final);
    if (!Number.isInteger(index) || index < 0 || index >= parent.value.length) {
      return { representable: false, value: root };
    }
    if (value === missingValue) {
      parent.value.splice(index, 1);
    } else {
      parent.value[index] = structuredClone(value);
    }
    return { representable: true, value: copy };
  }
  if (!isObject(parent.value)) {
    return { representable: false, value: root };
  }
  if (value === missingValue) {
    delete parent.value[final];
  } else {
    parent.value[final] = structuredClone(value);
  }
  return { representable: true, value: copy };
}

function getParent(
  root: JsonValue,
  segments: string[],
): { value: JsonValue } | undefined {
  let current: JsonValue = root;
  for (const segment of segments.slice(0, -1)) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return undefined;
      }
      const item = current[index];
      if (item === undefined) {
        return undefined;
      }
      current = item;
      continue;
    }
    if (
      !isObject(current) ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      return undefined;
    }
    const item = current[segment];
    if (item === undefined) {
      return undefined;
    }
    current = item;
  }
  return { value: current };
}

export function isObject(value: MaybeJson): value is Record<string, JsonValue> {
  return (
    value !== missingValue &&
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

export function escapePointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function unescapePointer(value: string): string {
  return value.replace(/~1/g, '/').replace(/~0/g, '~');
}
