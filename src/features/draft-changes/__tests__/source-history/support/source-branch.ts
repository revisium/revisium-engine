import objectHash from 'object-hash';
import {
  createJsonSchemaStore,
  getForeignKeyPatchesFromSchema,
  getForeignKeysFromSchema,
  pluginRefs,
  SchemaTable,
} from '@revisium/schema-toolkit/lib';
import type {
  JsonPatch,
  JsonSchema,
  Migration,
} from '@revisium/schema-toolkit/types';
import type {
  DraftChangesFingerprintInput,
  DraftChangesSnapshot,
} from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import { fingerprintDraftChangesSnapshot } from 'src/features/draft-changes/snapshot/fingerprint';
import type { HistoryPatches } from 'src/features/share/queries/impl/transactional/get-table-schema.query';
import { SystemTables } from 'src/features/share/system-tables.consts';

type SnapshotRevision = DraftChangesSnapshot['head'];
type SnapshotTable = SnapshotRevision['tables'][number];
type SnapshotRow = SnapshotTable['rows'][number];
type WithoutId<Item> = Item extends unknown ? Omit<Item, 'id'> : never;
type MigrationWithoutId = WithoutId<Migration>;

export interface SourceEventOptions {
  id?: string;
  hash?: string;
}

interface UserTableState {
  name: string;
  createdId: string;
  schemaRow?: { data: unknown; meta: unknown };
}

interface LedgerRowState {
  id: string;
  publishedAt: Date;
  data: unknown;
}

interface RevisionState {
  role: 'head' | 'draft';
  tables: UserTableState[];
  ledger?: LedgerRowState[];
}

const BRANCH_START = Date.parse('2026-01-01T00:00:00.000Z');
const EVENT_SPACING_MS = 1000;
const FIXTURE_DATE = new Date('2025-12-01T00:00:00.000Z');
const HISTORY_DATE = '2025-12-01T00:00:00.000Z';
const REVISION_SEQUENCES = { head: 1, draft: 2 } as const;

export class SourceBranch {
  private readonly head: RevisionState = {
    role: 'head',
    tables: [],
    ledger: [],
  };

  private readonly draft: RevisionState = {
    role: 'draft',
    tables: [],
    ledger: [],
  };

  private nextInstant = BRANCH_START;

  private refs: Record<string, JsonSchema> = { ...pluginRefs };

  writtenWithSchemaRefs(refs: Record<string, JsonSchema>): this {
    this.refs = { ...pluginRefs, ...refs };
    return this;
  }

  committedTable(
    name: string,
    schema: JsonSchema,
    options: { meta?: unknown; createdId?: string } = {},
  ): this {
    const migration = this.migration(
      { changeType: 'init', tableId: name, hash: objectHash(schema), schema },
      {},
    );
    for (const revision of [this.head, this.draft]) {
      revision.tables.push({
        name,
        createdId: options.createdId ?? `created-${name}`,
        schemaRow: {
          data: storedJson(schema),
          meta: structuredClone(options.meta ?? [rootEntry(schema)]),
        },
      });
      appendLedgerRow(revision, migration);
    }
    return this;
  }

  init(
    name: string,
    schema: JsonSchema,
    options: SourceEventOptions = {},
  ): this {
    const migration = this.migration(
      { changeType: 'init', tableId: name, hash: objectHash(schema), schema },
      options,
    );
    this.draft.tables.push({
      name,
      createdId: `draft-created-${name}-${migration.id}`,
      schemaRow: {
        data: storedJson(schema),
        meta: [rootEntry(schema)],
      },
    });
    appendLedgerRow(this.draft, migration);
    return this;
  }

  update(
    name: string,
    patches: JsonPatch[],
    options: SourceEventOptions = {},
  ): this {
    const schemaRow = requireSchemaRow(this.draft, name);
    const schema = this.applyPatches(schemaRow.data as JsonSchema, patches);
    appendHistory(schemaRow, patches, schema);
    appendLedgerRow(
      this.draft,
      this.migration(
        {
          changeType: 'update',
          tableId: name,
          hash: objectHash(schema),
          patches,
        },
        options,
      ),
    );
    return this;
  }

  rename(
    tableId: string,
    nextTableId: string,
    options: SourceEventOptions = {},
  ): this {
    requireTable(this.draft, tableId).name = nextTableId;
    for (const table of this.draft.tables) {
      this.retargetReferences(table, tableId, nextTableId);
    }
    appendLedgerRow(
      this.draft,
      this.migration({ changeType: 'rename', tableId, nextTableId }, options),
    );
    return this;
  }

  remove(name: string, options: SourceEventOptions = {}): this {
    this.draft.tables = this.draft.tables.filter(
      (table) => table.name !== name,
    );
    appendLedgerRow(
      this.draft,
      this.migration({ changeType: 'remove', tableId: name }, options),
    );
    return this;
  }

  recordPendingMigration(
    migration: MigrationWithoutId,
    options: SourceEventOptions = {},
  ): this {
    appendLedgerRow(this.draft, this.migration(migration, options));
    return this;
  }

  recordPendingLedgerRow(
    data: unknown,
    options: { id?: string; publishedAt?: string } = {},
  ): this {
    const id = options.id ?? this.allocateId();
    this.draft.ledger?.push({
      id,
      publishedAt: new Date(options.publishedAt ?? id),
      data,
    });
    return this;
  }

  withoutDraftLedger(): this {
    delete this.draft.ledger;
    return this;
  }

  editDraftHistoryEntry(
    name: string,
    historyIndex: number,
    edit: (entry: HistoryPatches) => HistoryPatches,
  ): this {
    const meta = requireSchemaRow(this.draft, name).meta as HistoryPatches[];
    const entry = meta[historyIndex];
    if (!entry) {
      throw new Error(`Expected Draft history entry ${historyIndex}.`);
    }
    meta[historyIndex] = edit(structuredClone(entry));
    return this;
  }

  replaceDraftMeta(name: string, meta: unknown): this {
    requireSchemaRow(this.draft, name).meta = meta;
    return this;
  }

  removeDraftSchemaRow(name: string): this {
    delete requireTable(this.draft, name).schemaRow;
    return this;
  }

  removeDraftTable(name: string): this {
    this.draft.tables = this.draft.tables.filter(
      (table) => table.name !== name,
    );
    return this;
  }

  replaceDraftTableCreatedId(name: string, createdId: string): this {
    requireTable(this.draft, name).createdId = createdId;
    return this;
  }

  snapshot(): DraftChangesSnapshot {
    const input: DraftChangesFingerprintInput = {
      branch: {
        id: 'branch',
        createdAt: FIXTURE_DATE,
        isRoot: true,
        projectId: 'project',
        name: 'main',
      },
      head: revisionSnapshot(this.head, {
        parentId: null,
        isHead: true,
        isDraft: false,
      }),
      draft: revisionSnapshot(this.draft, {
        parentId: 'head',
        isHead: false,
        isDraft: true,
      }),
    };
    return { ...input, fingerprint: fingerprintDraftChangesSnapshot(input) };
  }

  private migration(
    migration: MigrationWithoutId,
    options: SourceEventOptions,
  ): Migration {
    const id = options.id ?? this.allocateId();
    const hash = options.hash;
    if (hash !== undefined && 'hash' in migration) {
      return { ...structuredClone(migration), id, hash } as Migration;
    }
    return { ...structuredClone(migration), id } as Migration;
  }

  private allocateId(): string {
    const id = new Date(this.nextInstant).toISOString();
    this.nextInstant += EVENT_SPACING_MS;
    return id;
  }

  private applyPatches(schema: JsonSchema, patches: JsonPatch[]): JsonSchema {
    const table = new SchemaTable(structuredClone(schema), this.refs);
    table.applyPatches(structuredClone(patches));
    return storedJson(table.getSchema());
  }

  private retargetReferences(
    table: UserTableState,
    tableId: string,
    nextTableId: string,
  ): void {
    const schemaRow = table.schemaRow;
    if (!schemaRow) {
      return;
    }
    const schema = schemaRow.data as JsonSchema;
    const store = createJsonSchemaStore(structuredClone(schema), this.refs);
    if (!getForeignKeysFromSchema(store).includes(tableId)) {
      return;
    }
    const patches = getForeignKeyPatchesFromSchema(store, {
      tableId,
      nextTableId,
    });
    appendHistory(schemaRow, patches, this.applyPatches(schema, patches));
  }
}

export function givenBranch(): SourceBranch {
  return new SourceBranch();
}

export function permutedSnapshot(
  snapshot: DraftChangesSnapshot,
): DraftChangesSnapshot {
  const permuted = structuredClone(snapshot);
  for (const revision of [permuted.head, permuted.draft]) {
    revision.tables.reverse();
    for (const table of revision.tables) {
      table.rows.reverse();
    }
  }
  return permuted;
}

function rootEntry(schema: JsonSchema): HistoryPatches {
  return {
    patches: [{ op: 'add', path: '', value: structuredClone(schema) }],
    hash: objectHash(schema),
    date: HISTORY_DATE,
  };
}

function appendHistory(
  schemaRow: NonNullable<UserTableState['schemaRow']>,
  patches: JsonPatch[],
  schema: JsonSchema,
): void {
  (schemaRow.meta as HistoryPatches[]).push({
    patches: structuredClone(patches),
    hash: objectHash(schema),
    date: HISTORY_DATE,
  });
  schemaRow.data = schema;
}

function appendLedgerRow(revision: RevisionState, migration: Migration): void {
  revision.ledger?.push({
    id: migration.id,
    publishedAt: new Date(migration.id),
    data: structuredClone(migration),
  });
}

function requireTable(revision: RevisionState, name: string): UserTableState {
  const table = revision.tables.find((item) => item.name === name);
  if (!table) {
    throw new Error(`Expected ${revision.role} table '${name}'.`);
  }
  return table;
}

function requireSchemaRow(
  revision: RevisionState,
  name: string,
): NonNullable<UserTableState['schemaRow']> {
  const schemaRow = requireTable(revision, name).schemaRow;
  if (!schemaRow) {
    throw new Error(`Expected ${revision.role} schema row '${name}'.`);
  }
  return schemaRow;
}

function storedJson<Value>(value: Value): Value {
  return orderJsonbKeys(JSON.parse(JSON.stringify(value))) as Value;
}

function orderJsonbKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(orderJsonbKeys);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const keys = Object.keys(value).sort(
    (left, right) => left.length - right.length || (left < right ? -1 : 1),
  );
  return Object.fromEntries(
    keys.map((key) => [
      key,
      orderJsonbKeys((value as Record<string, unknown>)[key]),
    ]),
  );
}

function revisionSnapshot(
  revision: RevisionState,
  roleFields: Pick<SnapshotRevision, 'parentId' | 'isHead' | 'isDraft'>,
): SnapshotRevision {
  const userTables = revision.tables.map((table) =>
    tableSnapshot(revision.role, table.name, table.createdId, []),
  );
  const schemaRows = revision.tables.flatMap(({ name, schemaRow }) =>
    schemaRow
      ? [rowSnapshot(revision.role, name, schemaRow.data, schemaRow.meta)]
      : [],
  );
  const systemTables = [
    systemTableSnapshot(revision.role, SystemTables.Schema, schemaRows),
    ...ledgerTables(revision),
  ];
  return {
    id: revision.role,
    branchId: 'branch',
    sequence: REVISION_SEQUENCES[revision.role],
    createdAt: FIXTURE_DATE,
    comment: '',
    isStart: revision.role === 'head',
    hasChanges: revision.role === 'draft',
    ...roleFields,
    tables: [...systemTables, ...userTables],
  };
}

function ledgerTables(revision: RevisionState): SnapshotTable[] {
  if (!revision.ledger) {
    return [];
  }
  const rows = revision.ledger.map(({ id, publishedAt, data }) => ({
    ...rowSnapshot(revision.role, id, data, {}),
    publishedAt,
  }));
  return [systemTableSnapshot(revision.role, SystemTables.Migration, rows)];
}

function systemTableSnapshot(
  role: string,
  id: string,
  rows: SnapshotRow[],
): SnapshotTable {
  return { ...tableSnapshot(role, id, `${id}-created`, rows), system: true };
}

function tableSnapshot(
  role: string,
  id: string,
  createdId: string,
  rows: SnapshotRow[],
): SnapshotTable {
  return {
    id,
    createdId,
    versionId: `${role}-table-${id}`,
    readonly: role === 'head',
    createdAt: FIXTURE_DATE,
    updatedAt: FIXTURE_DATE,
    system: false,
    rows,
  };
}

function rowSnapshot(
  role: string,
  id: string,
  data: unknown,
  meta: unknown,
): SnapshotRow {
  return {
    id,
    createdId: `${id}-created`,
    versionId: `${role}-row-${id}`,
    readonly: role === 'head',
    createdAt: FIXTURE_DATE,
    updatedAt: FIXTURE_DATE,
    publishedAt: FIXTURE_DATE,
    data: storedJson(data) as SnapshotRow['data'],
    meta: storedJson(meta) as SnapshotRow['meta'],
    hash: objectHash(data as object),
    schemaHash: 'schema-hash',
    fileBlobs: [],
  };
}
