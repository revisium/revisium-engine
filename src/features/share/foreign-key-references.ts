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

export interface ForeignKeyReference {
  tableId: string;
  rowId: string;
  legacyPath: string;
}

export function getForeignKeyReferences(
  schema: JsonSchemaStore,
  value: JsonValue,
): ForeignKeyReference[] {
  const references: ForeignKeyReference[] = [];
  readValueReferences(schema, value, [], references);
  return references;
}

function readValueReferences(
  schema: JsonSchemaStore,
  value: JsonValue,
  dataSegments: string[],
  references: ForeignKeyReference[],
): void {
  if (schema.type === JsonSchemaTypeName.String) {
    appendStringReference(schema, value, dataSegments, references);
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
        references,
      );
    });
  }
}

function appendStringReference(
  schema: JsonStringStore,
  value: JsonValue,
  dataSegments: string[],
  references: ForeignKeyReference[],
): void {
  if (!schema.foreignKey || typeof value !== 'string') {
    return;
  }
  references.push({
    tableId: schema.foreignKey,
    rowId: value,
    legacyPath: dataSegments.length > 0 ? `/${dataSegments.join('/')}` : '/',
  });
}

function isObject(value: JsonValue): value is Record<string, JsonValue> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
