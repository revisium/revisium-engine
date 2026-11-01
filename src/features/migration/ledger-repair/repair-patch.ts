import { deepEqual, SchemaTable } from '@revisium/schema-toolkit/lib';
import { generateDefaultValue } from '@revisium/schema-toolkit/model';
import {
  type JsonArraySchema,
  type JsonObjectSchema,
  type JsonPatch,
  type JsonSchema,
  JsonSchemaTypeName,
  type JsonValue,
  type UpdateMigration,
} from '@revisium/schema-toolkit/types';
import objectHash from 'object-hash';
import type { SchemaRefs } from 'src/features/share/ledger-replay/native-schema-rules';
import { schemasEqual } from 'src/features/share/ledger-replay/schemas-equal';
import { NativeIdSequence } from './repair-ids';
import type { RepairLedger } from './repair-ledger';

const SAMPLE_ROW_ID = 'sample';

export interface RepairPatch {
  readonly patches: JsonPatch[];
  readonly hash: string;
  readonly removedPaths: string[];
}

export interface HistoryPatchesValidator {
  validateHistoryPatchesSchema(data: unknown): { result: boolean };
}

export function repairPatchOf(
  ledger: RepairLedger,
  tableId: string,
  validator: HistoryPatchesValidator,
): RepairPatch | undefined {
  const replayedSchema = ledger.replayedSchemaOf(tableId);
  const headSchema = ledger.headSchemaOf(tableId);

  if (!replayedSchema || !headSchema) {
    return undefined;
  }

  const patches = schemaPatchesBetween(replayedSchema, headSchema);
  const repair = { patches, hash: objectHash(headSchema) };

  if (
    !reproducesWhereInserted(ledger, tableId, repair, headSchema) ||
    !migratesSampleRow(
      ledger.rules.refs,
      replayedSchema,
      headSchema,
      patches,
    ) ||
    !validator.validateHistoryPatchesSchema([repair]).result
  ) {
    return undefined;
  }

  return { ...repair, removedPaths: removedPathsOf(patches) };
}

export function repairMigrationOf(
  tableId: string,
  { patches, hash }: Pick<RepairPatch, 'patches' | 'hash'>,
  id: string,
): UpdateMigration {
  return { changeType: 'update', id, tableId, hash, patches };
}

export function schemaPatchesBetween(
  from: JsonSchema,
  to: JsonSchema,
  path = '',
): JsonPatch[] {
  if (deepEqual(from, to)) {
    return [];
  }

  if (isObject(from) && isObject(to)) {
    return [
      ...propertyPatchesBetween(from.properties, to.properties, path),
      ...metadataPatchesBetween(from, to, path, sameObjectShell),
    ];
  }

  if (isArray(from) && isArray(to)) {
    return [
      ...schemaPatchesBetween(from.items, to.items, `${path}/items`),
      ...metadataPatchesBetween(from, to, path, sameArrayShell),
    ];
  }

  return [{ op: 'replace', path, value: to }];
}

function metadataPatchesBetween<T extends JsonSchema>(
  from: T,
  to: T,
  path: string,
  sameShell: (from: T, to: T) => boolean,
): JsonPatch[] {
  if (sameShell(from, to)) {
    return [];
  }

  return [{ op: 'replace', path, value: to }];
}

function migratesSampleRow(
  refs: SchemaRefs,
  replayedSchema: JsonSchema,
  headSchema: JsonSchema,
  patches: JsonPatch[],
): boolean {
  try {
    const replayedTable = new SchemaTable(replayedSchema, refs);
    replayedTable.addRow(SAMPLE_ROW_ID, sampleRowOf(replayedSchema, refs));
    replayedTable.applyPatches(patches);

    const headTable = new SchemaTable(headSchema, refs);
    for (const { id, data } of replayedTable.getRows()) {
      headTable.addRow(id, data);
    }

    return true;
  } catch {
    return false;
  }
}

function sampleRowOf(schema: JsonSchema, refs: SchemaRefs): JsonValue {
  return generateDefaultValue(schema, {
    arrayItemCount: 1,
    refSchemas: { ...refs },
  }) as JsonValue;
}

function reproducesWhereInserted(
  ledger: RepairLedger,
  tableId: string,
  repair: Pick<RepairPatch, 'patches' | 'hash'>,
  headSchema: JsonSchema,
): boolean {
  const insertionId = new NativeIdSequence(ledger.lastPublished).next();
  const replayed = ledger
    .replay([
      ...ledger.published,
      repairMigrationOf(tableId, repair, insertionId),
    ])
    .schemas.get(tableId);

  return replayed !== undefined && schemasEqual(replayed, headSchema);
}

function propertyPatchesBetween(
  from: Record<string, JsonSchema>,
  to: Record<string, JsonSchema>,
  path: string,
): JsonPatch[] {
  const fromFields = new Map(Object.entries(from));
  const toFields = new Map(Object.entries(to));
  const patches: JsonPatch[] = [];

  for (const name of fromFields.keys()) {
    if (!toFields.has(name)) {
      patches.push({ op: 'remove', path: propertyPath(path, name) });
    }
  }

  for (const [name, value] of toFields) {
    const previous = fromFields.get(name);
    const fieldPath = propertyPath(path, name);

    if (previous === undefined) {
      patches.push({ op: 'add', path: fieldPath, value });
    } else {
      patches.push(...schemaPatchesBetween(previous, value, fieldPath));
    }
  }

  return patches;
}

function removedPathsOf(patches: readonly JsonPatch[]): string[] {
  return patches.filter(({ op }) => op === 'remove').map(({ path }) => path);
}

function propertyPath(path: string, name: string): string {
  const escapedName = name.replaceAll('~', '~0').replaceAll('/', '~1');

  return `${path}/properties/${escapedName}`;
}

function isObject(schema: JsonSchema): schema is JsonObjectSchema {
  return 'type' in schema && schema.type === JsonSchemaTypeName.Object;
}

function isArray(schema: JsonSchema): schema is JsonArraySchema {
  return 'type' in schema && schema.type === JsonSchemaTypeName.Array;
}

function sameObjectShell(from: JsonObjectSchema, to: JsonObjectSchema) {
  return deepEqual(
    { ...from, properties: {}, required: [] },
    { ...to, properties: {}, required: [] },
  );
}

function sameArrayShell(from: JsonArraySchema, to: JsonArraySchema) {
  return deepEqual({ ...from, items: {} }, { ...to, items: {} });
}
