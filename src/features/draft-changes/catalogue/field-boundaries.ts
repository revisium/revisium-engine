import { pluginRefs } from '@revisium/schema-toolkit/lib';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import type { DraftChangesFieldBoundary } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import { escapePointer } from 'src/features/draft-changes/schema/json-value-path';

export function collectFieldBoundaries(
  tableCreatedId: string,
  schema: JsonSchema,
): DraftChangesFieldBoundary[] {
  const result: DraftChangesFieldBoundary[] = [];
  visit(schema, '', tableCreatedId, result, new Set());
  return result.sort((left, right) => comparePaths(left.path, right.path));
}

function comparePaths(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function visit(
  source: JsonSchema,
  dataPath: string,
  tableCreatedId: string,
  result: DraftChangesFieldBoundary[],
  seen: Set<string>,
): void {
  const ref = '$ref' in source ? source.$ref : undefined;
  if (ref === SystemSchemaIds.File) {
    result.push({ tableCreatedId, kind: 'file', path: dataPath });
    return;
  }
  let schema = source;
  if (ref) {
    schema = pluginRefs[ref] ?? source;
  }
  if (ref && seen.has(ref)) {
    return;
  }
  if (isComputed(schema, ref)) {
    result.push({ tableCreatedId, kind: 'computed', path: dataPath });
    return;
  }
  if ('type' in schema && schema.type === 'array') {
    result.push({ tableCreatedId, kind: 'array', path: dataPath });
    const nextSeen = new Set(seen);
    if (ref) {
      nextSeen.add(ref);
    }
    visit(schema.items, `${dataPath}/*`, tableCreatedId, result, nextSeen);
    return;
  }
  if ('type' in schema && schema.type === 'object') {
    const nextSeen = new Set(seen);
    if (ref) {
      nextSeen.add(ref);
    }
    visitObjectProperties(schema, dataPath, tableCreatedId, result, nextSeen);
  }
}

function isComputed(schema: JsonSchema, ref: string | undefined): boolean {
  if ('x-formula' in schema) {
    return true;
  }
  if (!ref) {
    return false;
  }
  const pluginSchema = pluginRefs[ref];
  return Boolean(
    pluginSchema && 'readOnly' in pluginSchema && pluginSchema.readOnly,
  );
}

function visitObjectProperties(
  schema: Extract<JsonSchema, { type: 'object' }>,
  dataPath: string,
  tableCreatedId: string,
  result: DraftChangesFieldBoundary[],
  seen: Set<string>,
): void {
  for (const [name, child] of Object.entries(schema.properties)) {
    visit(
      child,
      `${dataPath}/${escapePointer(name)}`,
      tableCreatedId,
      result,
      seen,
    );
  }
}
