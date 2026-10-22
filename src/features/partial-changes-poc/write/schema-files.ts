import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import type { JsonSchema } from '@revisium/schema-toolkit/types';

const usesFiles = new WeakMap<object, boolean>();
const usesFormulas = new WeakMap<object, boolean>();

export function schemaUsesFiles(schema: JsonSchema | undefined): boolean {
  return cachedCheck(usesFiles, schema, (node) =>
    containsKey(
      node,
      (key, value) => key === '$ref' && value === SystemSchemaIds.File,
    ),
  );
}

export function schemaUsesFormulas(schema: JsonSchema | undefined): boolean {
  return cachedCheck(usesFormulas, schema, (node) =>
    containsKey(node, (key) => key === 'x-formula'),
  );
}

function cachedCheck(
  cache: WeakMap<object, boolean>,
  schema: JsonSchema | undefined,
  check: (node: unknown) => boolean,
): boolean {
  if (!schema) {
    return false;
  }
  const cached = cache.get(schema);
  if (cached !== undefined) {
    return cached;
  }
  const result = check(schema);
  cache.set(schema, result);
  return result;
}

function containsKey(
  node: unknown,
  matches: (key: string, value: unknown) => boolean,
): boolean {
  if (Array.isArray(node)) {
    return node.some((item) => containsKey(item, matches));
  }
  if (node === null || typeof node !== 'object') {
    return false;
  }
  return Object.entries(node).some(
    ([key, value]) => matches(key, value) || containsKey(value, matches),
  );
}
