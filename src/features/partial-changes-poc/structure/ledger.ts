import {
  createJsonSchemaStore,
  getForeignKeyPatchesFromSchema,
  getForeignKeysFromSchema,
  SchemaTable,
} from '@revisium/schema-toolkit/lib';
import type { JsonSchema, Migration } from '@revisium/schema-toolkit/types';
import type { RowVersion } from 'src/features/partial-changes-poc/snapshot/snapshot.types';
import type { SchemaRefs } from 'src/features/partial-changes-poc/structure/table-structure';
import { sameJson } from 'src/features/partial-changes-poc/structure/same-json';

export interface LedgerEntry {
  version: RowVersion;
  migration: Migration;
}

export interface ReplayFailure {
  migrationId: string;
  tableId: string;
  message: string;
}

export interface ReplayResult {
  schemas: Map<string, JsonSchema>;
  failure?: ReplayFailure;
}

export function ledgerOf(rows: readonly RowVersion[]): LedgerEntry[] {
  return rows
    .map((version) => ({ version, migration: version.data as Migration }))
    .sort((a, b) => compareIds(a.migration.id, b.migration.id));
}

export function compareIds(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

export function replayLedger(
  migrations: readonly Migration[],
  refs: SchemaRefs,
): ReplayResult {
  const schemas = new Map<string, JsonSchema>();

  for (const migration of migrations) {
    const problem = applyMigration(schemas, migration, refs);
    if (problem) {
      return {
        schemas,
        failure: {
          migrationId: migration.id,
          tableId: migration.tableId,
          message: problem,
        },
      };
    }
  }

  return { schemas };
}

export function mismatchedTables(
  replayed: ReplayResult,
  actual: ReadonlyMap<string, JsonSchema>,
): string[] {
  const ids = new Set([...replayed.schemas.keys(), ...actual.keys()]);
  return [...ids]
    .filter((id) => !sameJson(replayed.schemas.get(id), actual.get(id)))
    .sort(compareIds);
}

function applyMigration(
  schemas: Map<string, JsonSchema>,
  migration: Migration,
  refs: SchemaRefs,
): string | undefined {
  try {
    switch (migration.changeType) {
      case 'init':
        return init(schemas, migration.tableId, migration.schema, refs);
      case 'update':
        return update(schemas, migration.tableId, migration, refs);
      case 'rename':
        return rename(schemas, migration.tableId, migration.nextTableId, refs);
      case 'remove':
        return remove(schemas, migration.tableId, refs);
      default:
        return 'unknown migration type';
    }
  } catch (error) {
    return (error as Error).message;
  }
}

function init(
  schemas: Map<string, JsonSchema>,
  tableId: string,
  schema: JsonSchema,
  refs: SchemaRefs,
): string | undefined {
  if (schemas.has(tableId)) {
    return `table ${tableId} already exists`;
  }
  const missing = missingForeignKeyTables(schemas, tableId, schema, refs);
  if (missing) {
    return missing;
  }
  schemas.set(tableId, structuredClone(schema));
  return undefined;
}

function update(
  schemas: Map<string, JsonSchema>,
  tableId: string,
  migration: Extract<Migration, { changeType: 'update' }>,
  refs: SchemaRefs,
): string | undefined {
  const current = schemas.get(tableId);
  if (!current) {
    return `table ${tableId} does not exist`;
  }
  const table = new SchemaTable(structuredClone(current), refs);
  table.applyPatches(structuredClone(migration.patches));
  const next = table.getSchema();
  const missing = missingForeignKeyTables(schemas, tableId, next, refs);
  if (missing) {
    return missing;
  }
  schemas.set(tableId, next);
  return undefined;
}

function rename(
  schemas: Map<string, JsonSchema>,
  tableId: string,
  nextTableId: string,
  refs: SchemaRefs,
): string | undefined {
  const current = schemas.get(tableId);
  if (!current) {
    return `table ${tableId} does not exist`;
  }
  if (schemas.has(nextTableId)) {
    return `table ${nextTableId} already exists`;
  }
  schemas.delete(tableId);
  schemas.set(nextTableId, current);

  for (const [id, schema] of schemas) {
    const store = createJsonSchemaStore(schema, refs);
    if (!getForeignKeysFromSchema(store).includes(tableId)) {
      continue;
    }
    const patches = getForeignKeyPatchesFromSchema(store, {
      tableId,
      nextTableId,
    });
    const table = new SchemaTable(structuredClone(schema), refs);
    table.applyPatches(patches);
    schemas.set(id, table.getSchema());
  }
  return undefined;
}

function remove(
  schemas: Map<string, JsonSchema>,
  tableId: string,
  refs: SchemaRefs,
): string | undefined {
  if (!schemas.has(tableId)) {
    return `table ${tableId} does not exist`;
  }
  const referrers = [...schemas]
    .filter(([id]) => id !== tableId)
    .filter(([, schema]) =>
      getForeignKeysFromSchema(createJsonSchemaStore(schema, refs)).includes(
        tableId,
      ),
    )
    .map(([id]) => id);
  if (referrers.length > 0) {
    return `table ${tableId} is referenced by ${referrers.join(', ')}`;
  }
  schemas.delete(tableId);
  return undefined;
}

function missingForeignKeyTables(
  schemas: ReadonlyMap<string, JsonSchema>,
  tableId: string,
  schema: JsonSchema,
  refs: SchemaRefs,
): string | undefined {
  const missing = getForeignKeysFromSchema(createJsonSchemaStore(schema, refs))
    .filter((referenced) => referenced !== tableId)
    .filter((referenced) => !schemas.has(referenced));
  return missing.length > 0
    ? `foreign key of ${tableId} references missing ${missing.join(', ')}`
    : undefined;
}

export interface LedgerAttribution {
  ownerOf: Map<string, string>;
  transient: Array<{ key: string; tableId: string; entries: LedgerEntry[] }>;
  problems: string[];
}

interface Slot {
  identity?: string;
  firstId: string;
  tableId: string;
  entries: LedgerEntry[];
}

export function attributePending(
  pending: readonly LedgerEntry[],
  headTables: ReadonlyMap<string, string>,
  draftTables: ReadonlyMap<string, string>,
): LedgerAttribution {
  const live = new Map<string, Slot>();
  const removed: Slot[] = [];
  const problems: string[] = [];

  for (const [id, identity] of headTables) {
    live.set(id, { identity, firstId: '', tableId: id, entries: [] });
  }

  for (const entry of pending) {
    const problem = follow(live, removed, entry);
    if (problem) {
      problems.push(problem);
    }
  }

  return resolveSlots(live, removed, draftTables, problems);
}

function follow(
  live: Map<string, Slot>,
  removed: Slot[],
  entry: LedgerEntry,
): string | undefined {
  const { migration } = entry;

  if (migration.changeType === 'init') {
    live.set(migration.tableId, {
      firstId: migration.id,
      tableId: migration.tableId,
      entries: [entry],
    });
    return undefined;
  }

  const slot = live.get(migration.tableId);
  if (!slot) {
    return `migration ${migration.id} refers to unknown table ${migration.tableId}`;
  }
  slot.entries.push(entry);

  if (migration.changeType === 'rename') {
    live.delete(migration.tableId);
    live.set(migration.nextTableId, slot);
  } else if (migration.changeType === 'remove') {
    live.delete(migration.tableId);
    removed.push(slot);
  }
  return undefined;
}

function resolveSlots(
  live: Map<string, Slot>,
  removed: Slot[],
  draftTables: ReadonlyMap<string, string>,
  problems: string[],
): LedgerAttribution {
  const ownerOf = new Map<string, string>();
  const transient: LedgerAttribution['transient'] = [];

  for (const [id, slot] of live) {
    const draftIdentity = draftTables.get(id);
    if (slot.identity && slot.identity !== draftIdentity) {
      problems.push(`table ${id} does not match its ledger history`);
    }
    slot.identity = slot.identity ?? draftIdentity;
  }

  for (const slot of [...live.values(), ...removed]) {
    const owner = slot.identity ?? `transient:${slot.firstId}:${slot.tableId}`;
    if (!slot.identity) {
      transient.push({
        key: owner,
        tableId: slot.tableId,
        entries: slot.entries,
      });
    }
    for (const entry of slot.entries) {
      ownerOf.set(entry.version.versionId, owner);
    }
  }

  return { ownerOf, transient, problems };
}
