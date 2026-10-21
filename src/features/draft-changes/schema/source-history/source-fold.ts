import objectHash from 'object-hash';
import {
  type RevisiumValidator,
  SchemaTable,
} from '@revisium/schema-toolkit/lib';
import type {
  InitMigration,
  JsonPatch,
  JsonSchema,
  Migration,
  RemoveMigration,
  RenameMigration,
  UpdateMigration,
} from '@revisium/schema-toolkit/types';
import type { DraftChangesRevisionSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import { exportSchemaModel } from 'src/features/draft-changes/schema/schema-model';
import {
  indexPersistedSchemas,
  type PersistedSchema,
  readPersistedSchema,
} from 'src/features/draft-changes/schema/source-history/source-persisted-schema';
import {
  createRetargetPatches,
  describeForeignKeys,
  findUnresolvedReferences,
  referencesTable,
} from 'src/features/draft-changes/schema/source-history/source-references';
import type {
  SourceEvent,
  SourceHistoryBlocker,
  SourceHistoryGroup,
  SourceTableTaint,
} from 'src/features/draft-changes/schema/source-history/source-history.types';
import { inStoredKeyOrder } from 'src/features/draft-changes/schema/source-history/source-stored-order';
import { sourceTaint } from 'src/features/draft-changes/schema/source-history/source-taints';
import { compareStrings } from 'src/features/draft-changes/snapshot/canonical-value';
import type { HistoryPatches } from 'src/features/share/queries/impl/transactional/get-table-schema.query';

export interface FoldTable {
  identity: string;
  head?: { tableId: string; historyLength: number };
  headHistory: HistoryPatches[];
  name?: string;
  historyLength: number;
  groups: FoldGroup[];
  progress: FoldProgress;
}

export type FoldProgress =
  | { status: 'tracked'; schema: JsonSchema }
  | { status: 'tainted'; taint: SourceTableTaint };

type LiveTable = FoldTable & { name: string };

type TrackedTable = FoldTable & {
  progress: Extract<FoldProgress, { status: 'tracked' }>;
};

export interface FoldGroup {
  group: SourceHistoryGroup;
  entry: { patches: JsonPatch[]; hash: string };
}

export interface FoldState {
  tables: Map<string, FoldTable>;
  names: Map<string, string>;
  events: SourceEvent[];
}

export type SourceFoldResult =
  | { state: FoldState }
  | { blocker: SourceHistoryBlocker };

type SchemaStep =
  | { status: 'applied'; schema: JsonSchema; patches: JsonPatch[] }
  | { status: 'failed'; message: string };

type AppliedStep = Extract<SchemaStep, { status: 'applied' }>;

interface AdmittedStep {
  schema: JsonSchema;
  patches: JsonPatch[];
  hash: string;
}

interface GroupCandidate {
  origin: SourceHistoryGroup['origin'];
  step: SchemaStep;
  recordedHash?: string;
  verifiesReferences: boolean;
}

interface FoldContext {
  state: FoldState;
  refs: Record<string, JsonSchema>;
}

export function foldSourceHistory(
  head: DraftChangesRevisionSnapshot,
  pendingMigrations: Migration[],
  refs: Record<string, JsonSchema>,
  validator: RevisiumValidator,
): SourceFoldResult {
  const context: FoldContext = {
    state: readStartState(head, validator),
    refs,
  };
  for (const [eventIndex, migration] of pendingMigrations.entries()) {
    const blocker = applyEvent(context, migration, eventIndex);
    if (blocker) {
      return { blocker };
    }
  }
  return { state: context.state };
}

function readStartState(
  head: DraftChangesRevisionSnapshot,
  validator: RevisiumValidator,
): FoldState {
  const state: FoldState = { tables: new Map(), names: new Map(), events: [] };
  const headTables = head.tables
    .filter(({ system }) => !system)
    .sort((left, right) => compareStrings(left.id, right.id));
  const headSchemas = indexPersistedSchemas(head);
  for (const table of headTables) {
    const persisted = readPersistedSchema(headSchemas, table.id, validator);
    addLiveTable(state, startTable(table.createdId, table.id, persisted));
  }
  return state;
}

function startTable(
  identity: string,
  tableId: string,
  persisted: PersistedSchema,
): FoldTable {
  if (persisted.status === 'invalid') {
    return {
      identity,
      head: { tableId, historyLength: persisted.historyLength },
      headHistory: [],
      name: tableId,
      historyLength: persisted.historyLength,
      groups: [],
      progress: {
        status: 'tainted',
        taint: sourceTaint('SOURCE_HISTORY_MISMATCH', 0, persisted.message),
      },
    };
  }
  return {
    identity,
    head: { tableId, historyLength: persisted.history.length },
    headHistory: persisted.history,
    name: tableId,
    historyLength: persisted.history.length,
    groups: [],
    progress: { status: 'tracked', schema: inStoredKeyOrder(persisted.schema) },
  };
}

function applyEvent(
  context: FoldContext,
  migration: Migration,
  eventIndex: number,
): SourceHistoryBlocker | undefined {
  switch (migration.changeType) {
    case 'init':
      return applyInit(context, migration, eventIndex);
    case 'update':
      return applyUpdate(context, migration, eventIndex);
    case 'rename':
      return applyRename(context, migration, eventIndex);
    case 'remove':
      return applyRemove(context, migration, eventIndex);
    default:
      return unknownChangeType(migration);
  }
}

function applyInit(
  { state, refs }: FoldContext,
  migration: InitMigration,
  eventIndex: number,
): SourceHistoryBlocker | undefined {
  if (state.names.has(migration.tableId)) {
    return invalidEvent(
      eventIndex,
      migration.tableId,
      `Pending event ${eventIndex} initializes table '${migration.tableId}', which is already live.`,
    );
  }
  if (state.tables.has(migration.id)) {
    return invalidEvent(
      eventIndex,
      migration.tableId,
      `Pending event ${eventIndex} initializes table '${migration.tableId}' with identity '${migration.id}', which another table already has.`,
    );
  }
  const table = addLiveTable(state, initializedTable(migration));
  recordEvent(state, migration, table.identity);
  admitGroup(state, table, {
    origin: { kind: 'init', eventIndex },
    step: constructSchema(migration.schema, refs),
    recordedHash: migration.hash,
    verifiesReferences: true,
  });
  return undefined;
}

function initializedTable(migration: InitMigration): FoldTable {
  return {
    identity: migration.id,
    headHistory: [],
    name: migration.tableId,
    historyLength: 0,
    groups: [],
    progress: { status: 'tracked', schema: inStoredKeyOrder(migration.schema) },
  };
}

function applyUpdate(
  { state, refs }: FoldContext,
  migration: UpdateMigration,
  eventIndex: number,
): SourceHistoryBlocker | undefined {
  const table = findLiveTable(state, migration.tableId);
  if (!table) {
    return missingTable(eventIndex, migration.tableId, 'updates');
  }
  recordEvent(state, migration, table.identity);
  if (!isTracked(table)) {
    return undefined;
  }
  admitGroup(state, table, {
    origin: { kind: 'update', eventIndex },
    step: patchSchema(table.progress.schema, migration.patches, refs),
    recordedHash: migration.hash,
    verifiesReferences: true,
  });
  return undefined;
}

function applyRename(
  { state, refs }: FoldContext,
  migration: RenameMigration,
  eventIndex: number,
): SourceHistoryBlocker | undefined {
  const table = findLiveTable(state, migration.tableId);
  if (!table) {
    return missingTable(eventIndex, migration.tableId, 'renames');
  }
  if (state.names.has(migration.nextTableId)) {
    return invalidEvent(
      eventIndex,
      migration.nextTableId,
      `Pending event ${eventIndex} renames table '${migration.tableId}' onto live table '${migration.nextTableId}'.`,
    );
  }
  recordEvent(state, migration, table.identity);
  moveLiveName(state, table, migration.nextTableId);
  retargetReferrers(state, migration, eventIndex, refs);
  return undefined;
}

function retargetReferrers(
  state: FoldState,
  migration: RenameMigration,
  eventIndex: number,
  refs: Record<string, JsonSchema>,
): void {
  for (const referrer of findTrackedReferrers(state, migration.tableId)) {
    admitGroup(state, referrer, {
      origin: { kind: 'renameReference', eventIndex },
      step: retargetSchema(referrer.progress.schema, migration, refs),
      verifiesReferences: false,
    });
  }
}

function applyRemove(
  { state }: FoldContext,
  migration: RemoveMigration,
  eventIndex: number,
): SourceHistoryBlocker | undefined {
  const table = findLiveTable(state, migration.tableId);
  if (!table) {
    return missingTable(eventIndex, migration.tableId, 'removes');
  }
  recordEvent(state, migration, table.identity);
  taintRemainingReferrers(state, table, eventIndex);
  freeLiveName(state, table);
  return undefined;
}

function taintRemainingReferrers(
  state: FoldState,
  removed: LiveTable,
  eventIndex: number,
): void {
  const referrers = findTrackedReferrers(state, removed.name).filter(
    ({ identity }) => identity !== removed.identity,
  );
  for (const referrer of referrers) {
    taintTable(
      referrer,
      sourceTaint(
        'SOURCE_REFERENCE_INCONSISTENT',
        referrer.historyLength,
        `Pending event ${eventIndex} removes table '${removed.name}' while it is still referenced.`,
      ),
    );
  }
}

function admitGroup(
  state: FoldState,
  table: FoldTable,
  candidate: GroupCandidate,
): void {
  const verdict = verifyCandidate(state, table.historyLength, candidate);
  if ('taint' in verdict) {
    taintTable(table, verdict.taint);
    return;
  }
  appendGroup(state, table, { origin: candidate.origin, ...verdict.admitted });
}

function verifyCandidate(
  state: FoldState,
  historyIndex: number,
  candidate: GroupCandidate,
): { taint: SourceTableTaint } | { admitted: AdmittedStep } {
  const { step } = candidate;
  if (step.status === 'failed') {
    return { taint: unreplayable(historyIndex, step.message) };
  }
  const hash = objectHash(step.schema);
  if (candidate.recordedHash !== undefined && hash !== candidate.recordedHash) {
    return {
      taint: unreplayable(
        historyIndex,
        'the recorded hash does not match the replayed schema.',
      ),
    };
  }
  const unresolved = findCandidateUnresolvedReferences(state, candidate, step);
  if (unresolved.length > 0) {
    return { taint: inconsistentReferences(historyIndex, unresolved) };
  }
  return { admitted: { schema: step.schema, patches: step.patches, hash } };
}

function findCandidateUnresolvedReferences(
  state: FoldState,
  candidate: GroupCandidate,
  step: AppliedStep,
): string[] {
  if (!candidate.verifiesReferences) {
    return [];
  }
  return findUnresolvedReferences(step.schema, state.names);
}

function constructSchema(
  schema: JsonSchema,
  refs: Record<string, JsonSchema>,
): SchemaStep {
  try {
    loadSchemaTable(schema, refs);
  } catch (error) {
    return failedStep(error);
  }
  return {
    status: 'applied',
    schema: inStoredKeyOrder(schema),
    patches: [{ op: 'add', path: '', value: structuredClone(schema) }],
  };
}

function patchSchema(
  schema: JsonSchema,
  patches: JsonPatch[],
  refs: Record<string, JsonSchema>,
): SchemaStep {
  try {
    return {
      status: 'applied',
      schema: applySchemaPatches(schema, patches, refs),
      patches: structuredClone(patches),
    };
  } catch (error) {
    return failedStep(error);
  }
}

function retargetSchema(
  schema: JsonSchema,
  rename: RenameMigration,
  refs: Record<string, JsonSchema>,
): SchemaStep {
  try {
    const patches = createRetargetPatches(schema, rename, refs);
    return {
      status: 'applied',
      schema: applySchemaPatches(schema, patches, refs),
      patches,
    };
  } catch (error) {
    return failedStep(error);
  }
}

function applySchemaPatches(
  schema: JsonSchema,
  patches: JsonPatch[],
  refs: Record<string, JsonSchema>,
): JsonSchema {
  const table = loadSchemaTable(schema, refs);
  table.applyPatches(structuredClone(patches));
  return inStoredKeyOrder(exportSchemaModel(table));
}

function loadSchemaTable(
  schema: JsonSchema,
  refs: Record<string, JsonSchema>,
): SchemaTable {
  return new SchemaTable(structuredClone(schema), refs);
}

function failedStep(error: unknown): SchemaStep {
  return {
    status: 'failed',
    message: error instanceof Error ? error.message : String(error),
  };
}

function unreplayable(historyIndex: number, reason: string): SourceTableTaint {
  return sourceTaint(
    'SOURCE_EVENT_UNREPLAYABLE',
    historyIndex,
    `Schema history entry ${historyIndex} cannot be replayed: ${reason}`,
  );
}

function inconsistentReferences(
  historyIndex: number,
  tableIds: string[],
): SourceTableTaint {
  return sourceTaint(
    'SOURCE_REFERENCE_INCONSISTENT',
    historyIndex,
    `Schema history entry ${historyIndex} references tables that are not live: ${tableIds.join(', ')}.`,
  );
}

function taintTable(table: FoldTable, taint: SourceTableTaint): void {
  table.progress = { status: 'tainted', taint };
}

function appendGroup(
  state: FoldState,
  table: FoldTable,
  step: AdmittedStep & { origin: SourceHistoryGroup['origin'] },
): void {
  table.groups.push({
    group: {
      historyIndex: table.historyLength,
      origin: step.origin,
      foreignKeys: describeForeignKeys(step.schema, state.names),
    },
    entry: { patches: step.patches, hash: step.hash },
  });
  table.historyLength += 1;
  table.progress = { status: 'tracked', schema: step.schema };
}

function findTrackedReferrers(
  state: FoldState,
  tableId: string,
): TrackedTable[] {
  return [...state.names.values()]
    .sort(compareStrings)
    .map((identity) => state.tables.get(identity))
    .filter((table): table is TrackedTable => isTracked(table))
    .filter(({ progress }) => referencesTable(progress.schema, tableId));
}

function isTracked(table: FoldTable | undefined): table is TrackedTable {
  return table?.progress.status === 'tracked';
}

function moveLiveName(
  state: FoldState,
  table: LiveTable,
  nextName: string,
): void {
  state.names.delete(table.name);
  state.names.set(nextName, table.identity);
  table.name = nextName;
}

function freeLiveName(state: FoldState, table: LiveTable): void {
  state.names.delete(table.name);
  delete (table as FoldTable).name;
}

function addLiveTable(state: FoldState, table: FoldTable): FoldTable {
  state.tables.set(table.identity, table);
  if (table.name !== undefined) {
    state.names.set(table.name, table.identity);
  }
  return table;
}

function findLiveTable(state: FoldState, name: string): LiveTable | undefined {
  const identity = state.names.get(name);
  const table = identity === undefined ? undefined : state.tables.get(identity);
  return isLive(table) ? table : undefined;
}

function isLive(table: FoldTable | undefined): table is LiveTable {
  return table?.name !== undefined;
}

function recordEvent(
  state: FoldState,
  migration: Migration,
  tableIdentity: string,
): void {
  state.events.push({ migration: structuredClone(migration), tableIdentity });
}

function missingTable(
  eventIndex: number,
  tableId: string,
  action: string,
): SourceHistoryBlocker {
  return invalidEvent(
    eventIndex,
    tableId,
    `Pending event ${eventIndex} ${action} table '${tableId}', which is not live.`,
  );
}

function unknownChangeType(migration: never): never {
  throw new Error(
    `Unsupported migration change type: ${JSON.stringify(migration)}`,
  );
}

function invalidEvent(
  eventIndex: number,
  tableId: string,
  message: string,
): SourceHistoryBlocker {
  return { code: 'SOURCE_EVENT_INVALID', message, eventIndex, tableId };
}
