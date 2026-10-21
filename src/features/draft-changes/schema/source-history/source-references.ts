import {
  createJsonSchemaStore,
  getForeignKeyPatchesFromSchema,
} from '@revisium/schema-toolkit/lib';
import type { JsonPatch, JsonSchema } from '@revisium/schema-toolkit/types';
import { createForeignKeyProvenance } from 'src/features/draft-changes/schema/foreign-key-retarget';
import type { SourceForeignKey } from 'src/features/draft-changes/schema/source-history/source-history.types';
import { compareStrings } from 'src/features/draft-changes/snapshot/canonical-value';

export function describeForeignKeys(
  schema: JsonSchema,
  liveIdentities: ReadonlyMap<string, string>,
): SourceForeignKey[] {
  return readForeignKeys(schema)
    .sort((left, right) => compareStrings(left.path, right.path))
    .map(({ path, targetTableId }) =>
      resolveForeignKey(path, targetTableId, liveIdentities.get(targetTableId)),
    );
}

export function findUnresolvedReferences(
  schema: JsonSchema,
  liveIdentities: ReadonlyMap<string, string>,
): string[] {
  const targets = readForeignKeys(schema).map(
    ({ targetTableId }) => targetTableId,
  );
  return [...new Set(targets)]
    .filter((target) => !liveIdentities.has(target))
    .sort(compareStrings);
}

function readForeignKeys(
  schema: JsonSchema,
): Array<{ path: string; targetTableId: string }> {
  return [...createForeignKeyProvenance(schema, 'draft')]
    .filter(([, { foreignKey }]) => foreignKey !== '')
    .map(([path, { foreignKey }]) => ({ path, targetTableId: foreignKey }));
}

export function referencesTable(value: unknown, tableId: string): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => referencesTable(item, tableId));
  }
  if (!isRecord(value)) {
    return false;
  }
  if (value.foreignKey === tableId) {
    return true;
  }
  return Object.values(value).some((child) => referencesTable(child, tableId));
}

export function createRetargetPatches(
  schema: JsonSchema,
  rename: { tableId: string; nextTableId: string },
  refs: Record<string, JsonSchema>,
): JsonPatch[] {
  const store = createJsonSchemaStore(structuredClone(schema), refs);
  return getForeignKeyPatchesFromSchema(store, {
    tableId: rename.tableId,
    nextTableId: rename.nextTableId,
  });
}

function resolveForeignKey(
  path: string,
  targetTableId: string,
  targetIdentity: string | undefined,
): SourceForeignKey {
  if (targetIdentity === undefined) {
    return { path, targetTableId };
  }
  return { path, targetTableId, targetIdentity };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
