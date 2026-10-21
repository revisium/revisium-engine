import {
  getObjectSchema,
  getRefSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import type { JsonPatch, JsonSchema } from '@revisium/schema-toolkit/types';

export const productsSchema = getObjectSchema({ title: getStringSchema() });

export function referencing(...tableIds: string[]): JsonSchema {
  return referenceFields(
    Object.fromEntries(tableIds.map((tableId) => [tableId, tableId])),
  );
}

export function referenceFields(targets: Record<string, string>): JsonSchema {
  return getObjectSchema(
    Object.fromEntries(
      Object.entries(targets).map(([field, tableId]) => [
        field,
        getStringSchema({ foreignKey: tableId }),
      ]),
    ),
  );
}

const sharedFieldRef = 'urn:test:shared-field';

export const sharedFieldRefs: Record<string, JsonSchema> = {
  [sharedFieldRef]: getObjectSchema({ line: getStringSchema() }),
};

export function referencingWithSharedField(tableId: string): JsonSchema {
  return getObjectSchema({
    [tableId]: getStringSchema({ foreignKey: tableId }),
    shared: getRefSchema(sharedFieldRef),
  });
}

export function addTextField(name: string): JsonPatch[] {
  return [{ op: 'add', path: `/properties/${name}`, value: getStringSchema() }];
}

export function addReferenceField(name: string, tableId: string): JsonPatch[] {
  return [
    {
      op: 'add',
      path: `/properties/${name}`,
      value: getStringSchema({ foreignKey: tableId }),
    },
  ];
}

export function replaceReference(field: string, tableId: string): JsonPatch[] {
  return [
    {
      op: 'replace',
      path: `/properties/${field}`,
      value: getStringSchema({ foreignKey: tableId }),
    },
  ];
}

export function removeMissingField(): JsonPatch[] {
  return [{ op: 'remove', path: '/properties/missing' }];
}
