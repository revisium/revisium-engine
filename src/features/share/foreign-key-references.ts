import { getPathByStore, traverseStore } from '@revisium/schema-toolkit/lib';
import type {
  JsonArrayStore,
  JsonObjectStore,
  JsonSchemaStore,
  JsonStringStore,
} from '@revisium/schema-toolkit/model';
import {
  JsonSchemaTypeName,
  type JsonValue,
} from '@revisium/schema-toolkit/types';
import { escapePointer } from 'src/features/share/json-pointer';

export interface ForeignKeyReference {
  tableId: string;
  rowId: string;
  segments: string[];
  jsonPointer: string;
  schemaPath: string;
  legacyPath: string;
}

export function getForeignKeyReferences(
  schema: JsonSchemaStore,
  value: JsonValue,
): ForeignKeyReference[] {
  const references: ForeignKeyReference[] = [];
  readValueReferences(schema, value, [], [], references);
  return references;
}

export function getForeignKeySchemaReferences(
  schema: JsonSchemaStore,
): Array<{ tableId: string; schemaPath: string }> {
  const references: Array<{ tableId: string; schemaPath: string }> = [];
  traverseStore(schema, (node) => {
    if (node.type !== JsonSchemaTypeName.String || !node.foreignKey) {
      return;
    }
    references.push({
      tableId: node.foreignKey,
      schemaPath: getPathByStore(node),
    });
  });
  return references;
}

function readValueReferences(
  schema: JsonSchemaStore,
  value: JsonValue,
  dataSegments: string[],
  schemaSegments: string[],
  references: ForeignKeyReference[],
): void {
  if (schema.type === JsonSchemaTypeName.String) {
    appendStringReference(
      schema,
      value,
      dataSegments,
      schemaSegments,
      references,
    );
    return;
  }
  if (schema.type === JsonSchemaTypeName.Object && isObject(value)) {
    for (const [key, childValue] of Object.entries(value)) {
      const childSchema = (schema as JsonObjectStore).getProperty(key);
      if (childSchema) {
        readValueReferences(
          childSchema,
          childValue,
          [...dataSegments, key],
          [...schemaSegments, 'properties', key],
          references,
        );
      }
    }
    return;
  }
  if (schema.type === JsonSchemaTypeName.Array && Array.isArray(value)) {
    const itemSchema = (schema as JsonArrayStore).items;
    value.forEach((item, index) => {
      readValueReferences(
        itemSchema,
        item,
        [...dataSegments, String(index)],
        [...schemaSegments, 'items'],
        references,
      );
    });
  }
}

function appendStringReference(
  schema: JsonStringStore,
  value: JsonValue,
  dataSegments: string[],
  schemaSegments: string[],
  references: ForeignKeyReference[],
): void {
  if (!schema.foreignKey || typeof value !== 'string') {
    return;
  }
  references.push({
    tableId: schema.foreignKey,
    rowId: value,
    segments: dataSegments,
    jsonPointer: pointerFromSegments(dataSegments),
    schemaPath: pointerFromSegments(schemaSegments),
    legacyPath: dataSegments.length > 0 ? `/${dataSegments.join('/')}` : '/',
  });
}

function isObject(value: JsonValue): value is Record<string, JsonValue> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function pointerFromSegments(segments: string[]): string {
  return segments.length === 0
    ? ''
    : `/${segments.map(escapePointer).join('/')}`;
}
