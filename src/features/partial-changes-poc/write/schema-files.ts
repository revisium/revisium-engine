import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import type { JsonSchema } from '@revisium/schema-toolkit/types';

const checked = new WeakMap<object, boolean>();

export function schemaUsesFiles(schema: JsonSchema | undefined): boolean {
  if (!schema) {
    return false;
  }
  const cached = checked.get(schema);
  if (cached !== undefined) {
    return cached;
  }
  const result = containsFileRef(schema);
  checked.set(schema, result);
  return result;
}

function containsFileRef(node: unknown): boolean {
  if (Array.isArray(node)) {
    return node.some(containsFileRef);
  }
  if (node === null || typeof node !== 'object') {
    return false;
  }
  return Object.entries(node).some(([key, value]) =>
    key === '$ref' ? value === SystemSchemaIds.File : containsFileRef(value),
  );
}
