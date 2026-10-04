import type {
  JsonArraySchema,
  JsonObjectSchema,
  JsonSchema,
} from '@revisium/schema-toolkit/types';
import { deepEqual } from '@revisium/schema-toolkit/lib';
import type { FieldIdentityMap } from 'src/features/draft-changes/schema/field-lineage';
import {
  isObject,
  missingValue,
  type MaybeJson,
  escapePointer,
  unescapePointer,
} from 'src/features/draft-changes/schema/json-value-path';

export interface FieldValue {
  identity: string;
  schemaPath: string;
  indexPath: number[];
  value: MaybeJson;
  dataPath: string;
}

export function collectValues(
  schema: JsonSchema,
  data: MaybeJson,
  identities: FieldIdentityMap,
  schemaPath = '',
  dataPath = '',
  indexPath: number[] = [],
): FieldValue[] {
  if (isObjectSchema(schema)) {
    return Object.entries(schema.properties).flatMap(([name, child]) => {
      const childPath = `${schemaPath}/properties/${escapePointer(name)}`;
      const childDataPath = `${dataPath}/${escapePointer(name)}`;
      const childValue =
        isObject(data) && Object.prototype.hasOwnProperty.call(data, name)
          ? data[name]
          : undefined;
      const value = childValue === undefined ? missingValue : childValue;
      return collectValues(
        child,
        value,
        identities,
        childPath,
        childDataPath,
        indexPath,
      );
    });
  }
  if (isArraySchema(schema)) {
    if (!Array.isArray(data)) {
      return [fieldValue(identities, schemaPath, dataPath, indexPath, data)];
    }
    const itemSchema = schema.items;
    if (!itemSchema) {
      return [fieldValue(identities, schemaPath, dataPath, indexPath, data)];
    }
    return [
      fieldValue(identities, schemaPath, dataPath, indexPath, data),
      ...data.flatMap((item, index) =>
        collectValues(
          itemSchema,
          item,
          identities,
          `${schemaPath}/items`,
          `${dataPath}/${index}`,
          [...indexPath, index],
        ),
      ),
    ];
  }
  return [fieldValue(identities, schemaPath, dataPath, indexPath, data)];
}

function fieldValue(
  identities: FieldIdentityMap,
  schemaPath: string,
  dataPath: string,
  indexPath: number[],
  value: MaybeJson,
): FieldValue {
  return {
    identity: identities.get(schemaPath) ?? `missing:${schemaPath}`,
    schemaPath,
    indexPath,
    value,
    dataPath,
  };
}

export function valueKey(field: FieldValue): string {
  return `${field.identity}:${field.indexPath.join('.')}`;
}

export function sameValue(left: MaybeJson, right: MaybeJson): boolean {
  if (left === missingValue || right === missingValue) {
    return left === right;
  }
  return deepEqual(left, right);
}

export function schemaAtPath(
  schema: JsonSchema,
  path: string,
): JsonSchema | undefined {
  let current: JsonSchema | undefined = schema;
  const segments = path.split('/').slice(1).map(unescapePointer);
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === 'properties') {
      const field = segments[index + 1];
      if (!current || !isObjectSchema(current) || !field) {
        return undefined;
      }
      current = current.properties[field];
      index += 1;
      continue;
    }
    if (segment === 'items') {
      if (!current || !isArraySchema(current)) {
        return undefined;
      }
      current = current.items;
    }
  }
  return current;
}

export function schemaPathToDataPath(path: string, indexes: number[]): string {
  const schemaSegments = path.split('/').slice(1);
  const output: string[] = [];
  let index = 0;
  for (let cursor = 0; cursor < schemaSegments.length; cursor += 1) {
    const rawSegment = schemaSegments[cursor];
    if (rawSegment === undefined) {
      continue;
    }
    const segment = unescapePointer(rawSegment);
    if (segment === 'properties') {
      const property = schemaSegments[cursor + 1];
      if (property === undefined) {
        continue;
      }
      output.push(property);
      cursor += 1;
    } else if (segment === 'items') {
      output.push(String(indexes[index] ?? 0));
      index += 1;
    }
  }
  return output.length === 0 ? '' : `/${output.join('/')}`;
}

export function isObjectSchema(schema: JsonSchema): schema is JsonObjectSchema {
  return 'type' in schema && schema.type === 'object';
}

export function isArraySchema(
  schema: JsonSchema | undefined,
): schema is JsonArraySchema {
  return schema !== undefined && 'type' in schema && schema.type === 'array';
}
