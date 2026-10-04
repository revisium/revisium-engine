import type { JsonPatch, JsonSchema } from '@revisium/schema-toolkit/types';
import type { HistoryGroup } from 'src/features/draft-changes/schema/schema-history';
import { escapePointer } from 'src/features/draft-changes/schema/json-value-path';

export type FieldIdentityMap = Map<string, string>;

export function createFieldIdentities(schema: JsonSchema): FieldIdentityMap {
  let nextId = 0;
  const identities = new Map<string, string>();
  addSchemaIdentities(schema, '', identities, () => `field-${nextId++}`);
  return identities;
}

export function applyFieldLineage(
  initial: FieldIdentityMap,
  groups: HistoryGroup[],
): FieldIdentityMap {
  const identities = new Map(initial);
  for (const group of groups) {
    group.patches.forEach((patch, offset) => {
      const patchIndex = group.patchIndexes[offset];
      if (patchIndex === undefined) {
        return;
      }
      applyPatchLineage(identities, patch, (path) =>
        effectIdentity(group.historyIndex, patchIndex, path),
      );
    });
  }
  return identities;
}

export function mapFieldCoordinates(
  from: FieldIdentityMap,
  to: FieldIdentityMap,
): Array<{ fromPath: string; toPath: string }> {
  const fromByIdentity = new Map(
    [...from].map(([path, identity]) => [identity, path]),
  );
  return [...to].flatMap(([toPath, identity]) => {
    const fromPath = fromByIdentity.get(identity);
    if (fromPath === undefined || fromPath === '' || toPath === '') {
      return [];
    }
    return [
      {
        fromPath: schemaPathToFieldPath(fromPath),
        toPath: schemaPathToFieldPath(toPath),
      },
    ];
  });
}

function applyPatchLineage(
  identities: FieldIdentityMap,
  patch: JsonPatch,
  newId: (path: string) => string,
): void {
  if (patch.op === 'move') {
    moveSubtree(identities, patch.from, patch.path);
    return;
  }
  if (patch.op === 'remove') {
    deleteSubtree(identities, patch.path);
    return;
  }
  if (patch.op === 'add') {
    if (patch.path !== '') {
      deleteSubtree(identities, patch.path);
      addSchemaIdentities(
        patch.value as JsonSchema,
        patch.path,
        identities,
        newId,
      );
    }
    return;
  }
  if (patch.op === 'replace') {
    const previous = new Map(
      [...identities].filter(([path]) => isSameOrBelow(path, patch.path)),
    );
    const rootIdentity = previous.get(patch.path) ?? newId(patch.path);
    deleteSubtree(identities, patch.path);
    identities.set(patch.path, rootIdentity);
    addReplacementChildren(
      patch.value as JsonSchema,
      patch.path,
      identities,
      newId,
      previous,
    );
  }
}

function moveSubtree(
  identities: FieldIdentityMap,
  from: string,
  to: string,
): void {
  const moved = [...identities].filter(([path]) => isSameOrBelow(path, from));
  deleteSubtree(identities, to);
  for (const [path] of moved) {
    identities.delete(path);
  }
  for (const [path, identity] of moved) {
    identities.set(`${to}${path.slice(from.length)}`, identity);
  }
}

function deleteSubtree(identities: FieldIdentityMap, root: string): void {
  for (const path of identities.keys()) {
    if (isSameOrBelow(path, root)) {
      identities.delete(path);
    }
  }
}

function addSchemaIdentities(
  schema: JsonSchema,
  path: string,
  identities: FieldIdentityMap,
  newId: (path: string) => string,
): void {
  identities.set(path, newId(path));
  addSchemaChildren(schema, path, identities, newId);
}

function addSchemaChildren(
  schema: JsonSchema,
  path: string,
  identities: FieldIdentityMap,
  newId: (path: string) => string,
): void {
  if ('type' in schema && schema.type === 'object') {
    for (const [name, child] of Object.entries(schema.properties)) {
      addSchemaIdentities(
        child,
        `${path}/properties/${escapePointer(name)}`,
        identities,
        newId,
      );
    }
  }
  if ('type' in schema && schema.type === 'array') {
    addSchemaIdentities(schema.items, `${path}/items`, identities, newId);
  }
}

function addReplacementChildren(
  schema: JsonSchema,
  path: string,
  identities: FieldIdentityMap,
  newId: (path: string) => string,
  previous: FieldIdentityMap,
): void {
  if ('type' in schema && schema.type === 'object') {
    for (const [name, child] of Object.entries(schema.properties)) {
      const childPath = `${path}/properties/${escapePointer(name)}`;
      identities.set(childPath, previous.get(childPath) ?? newId(childPath));
      addReplacementChildren(child, childPath, identities, newId, previous);
    }
  }
  if ('type' in schema && schema.type === 'array') {
    const itemPath = `${path}/items`;
    identities.set(itemPath, previous.get(itemPath) ?? newId(itemPath));
    addReplacementChildren(schema.items, itemPath, identities, newId, previous);
  }
}

function isSameOrBelow(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function schemaPathToFieldPath(path: string): string {
  const schemaSegments = path.split('/').slice(1);
  const fieldSegments: string[] = [];
  for (let index = 0; index < schemaSegments.length; index += 1) {
    const segment = schemaSegments[index];
    if (segment === 'properties') {
      const field = schemaSegments[index + 1];
      if (field !== undefined) {
        fieldSegments.push(field);
        index += 1;
      }
    } else if (segment === 'items') {
      fieldSegments.push('items');
    }
  }
  return fieldSegments.length === 0 ? '' : `/${fieldSegments.join('/')}`;
}

function effectIdentity(
  historyIndex: number,
  patchIndex: number,
  path: string,
): string {
  return `effect:${historyIndex}:${patchIndex}:${path}`;
}
