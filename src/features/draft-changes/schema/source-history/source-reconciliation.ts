import {
  deepEqual,
  type RevisiumValidator,
} from '@revisium/schema-toolkit/lib';
import type { DraftChangesRevisionSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type {
  FoldState,
  FoldTable,
} from 'src/features/draft-changes/schema/source-history/source-fold';
import {
  indexPersistedSchemas,
  type PersistedSchema,
  type PersistedSchemaIndex,
  readPersistedSchema,
} from 'src/features/draft-changes/schema/source-history/source-persisted-schema';
import type {
  SourceHistoryBlocker,
  SourceTable,
  SourceTableTaint,
} from 'src/features/draft-changes/schema/source-history/source-history.types';
import {
  combineTaints,
  groupsBelowTaint,
  sourceTaint,
} from 'src/features/draft-changes/schema/source-history/source-taints';
import { compareStrings } from 'src/features/draft-changes/snapshot/canonical-value';
import type { HistoryPatches } from 'src/features/share/queries/impl/transactional/get-table-schema.query';

type RevisionTable = DraftChangesRevisionSnapshot['tables'][number];

type HistoryEntry = Pick<HistoryPatches, 'patches' | 'hash'>;

interface TableSides {
  state: FoldState;
  draftTables: Map<string, RevisionTable[]>;
  headIdentities: ReadonlySet<string>;
}

interface DraftContext {
  draftTables: Map<string, RevisionTable[]>;
  draftSchemas: PersistedSchemaIndex;
  validator: RevisiumValidator;
}

export type SourceReconciliationResult =
  | { tables: SourceTable[] }
  | { blocker: SourceHistoryBlocker };

export function reconcileWithDraft(
  state: FoldState,
  draft: DraftChangesRevisionSnapshot,
  validator: RevisiumValidator,
): SourceReconciliationResult {
  const draftTables = groupDraftTables(draft);
  const blocker = findTablesMismatch(state, draftTables);
  if (blocker) {
    return { blocker };
  }

  const context: DraftContext = {
    draftTables,
    draftSchemas: indexPersistedSchemas(draft),
    validator,
  };
  const tables = [...state.tables.values()]
    .map((table) => reconcileTable(table, context))
    .sort((left, right) => compareStrings(left.identity, right.identity));
  return { tables };
}

function groupDraftTables(
  draft: DraftChangesRevisionSnapshot,
): Map<string, RevisionTable[]> {
  const tables = new Map<string, RevisionTable[]>();
  for (const table of draft.tables.filter(({ system }) => !system)) {
    tables.set(table.id, [...(tables.get(table.id) ?? []), table]);
  }
  return tables;
}

function findTablesMismatch(
  state: FoldState,
  draftTables: Map<string, RevisionTable[]>,
): SourceHistoryBlocker | undefined {
  const names = [...new Set([...state.names.keys(), ...draftTables.keys()])];
  const headIdentities = new Set(
    [...state.tables.values()]
      .filter(({ head }) => head !== undefined)
      .map(({ identity }) => identity),
  );
  for (const name of names.sort(compareStrings)) {
    const blocker = compareTableName(
      { state, draftTables, headIdentities },
      name,
    );
    if (blocker) {
      return blocker;
    }
  }
  return undefined;
}

function compareTableName(
  sides: TableSides,
  name: string,
): SourceHistoryBlocker | undefined {
  const identity = sides.state.names.get(name);
  const counterparts = sides.draftTables.get(name) ?? [];
  const [counterpart] = counterparts;
  if (identity === undefined || counterparts.length !== 1 || !counterpart) {
    return tablesMismatch(
      name,
      identity,
      `Table '${name}' is not live exactly once on both the traced and the Draft side.`,
    );
  }
  return compareCounterpartIdentity(
    sides.headIdentities,
    identity,
    counterpart,
  );
}

function compareCounterpartIdentity(
  headIdentities: ReadonlySet<string>,
  identity: string,
  counterpart: RevisionTable,
): SourceHistoryBlocker | undefined {
  if (headIdentities.has(identity) && counterpart.createdId !== identity) {
    return tablesMismatch(
      counterpart.id,
      identity,
      `Head table '${identity}' is live in Draft as '${counterpart.id}' under another identity.`,
    );
  }
  if (
    !headIdentities.has(identity) &&
    headIdentities.has(counterpart.createdId)
  ) {
    return tablesMismatch(
      counterpart.id,
      identity,
      `Pending table '${identity}' is live in Draft as '${counterpart.id}' under Head identity '${counterpart.createdId}'.`,
    );
  }
  return undefined;
}

function reconcileTable(table: FoldTable, context: DraftContext): SourceTable {
  const foldTaint = currentTaint(table);
  if (table.name === undefined) {
    return describeTable(table, undefined, foldTaint);
  }
  const [draftTable] = context.draftTables.get(table.name) ?? [];
  const persisted = readPersistedSchema(
    context.draftSchemas,
    table.name,
    context.validator,
  );
  const taint = combineTaints(foldTaint, reconcileHistory(table, persisted));
  return describeTable(table, draftTable, taint);
}

function reconcileHistory(
  table: FoldTable,
  persisted: PersistedSchema,
): SourceTableTaint | undefined {
  if (persisted.status === 'invalid') {
    return sourceTaint('SOURCE_HISTORY_MISMATCH', 0, persisted.message);
  }

  const mismatchIndex = findHistoryMismatch(
    tracedHistory(table),
    persisted.history,
    currentTaint(table)?.fromHistoryIndex,
  );
  if (mismatchIndex !== undefined) {
    return sourceTaint(
      'SOURCE_HISTORY_MISMATCH',
      mismatchIndex,
      `Draft schema history differs from the traced history at entry ${mismatchIndex}.`,
    );
  }

  if (
    table.progress.status === 'tracked' &&
    !deepEqual(table.progress.schema, persisted.schema)
  ) {
    return sourceTaint(
      'SOURCE_SCHEMA_UNRECORDED_CHANGE',
      persisted.history.length,
      'Draft schema differs from the schema its history produces.',
    );
  }
  return undefined;
}

function tracedHistory(table: FoldTable): HistoryEntry[] {
  return [...table.headHistory, ...table.groups.map(({ entry }) => entry)];
}

function findHistoryMismatch(
  traced: HistoryEntry[],
  persisted: HistoryEntry[],
  taintIndex: number | undefined,
): number | undefined {
  const comparedLength = Math.min(
    taintIndex ?? Number.POSITIVE_INFINITY,
    Math.max(traced.length, persisted.length),
  );
  for (let index = 0; index < comparedLength; index += 1) {
    if (!isSameEntry(traced[index], persisted[index])) {
      return index;
    }
  }
  return undefined;
}

function isSameEntry(
  traced: HistoryEntry | undefined,
  persisted: HistoryEntry | undefined,
): boolean {
  if (!traced || !persisted) {
    return false;
  }
  return (
    traced.hash === persisted.hash &&
    deepEqual(traced.patches, persisted.patches)
  );
}

function currentTaint(table: FoldTable): SourceTableTaint | undefined {
  return table.progress.status === 'tainted' ? table.progress.taint : undefined;
}

function describeTable(
  table: FoldTable,
  draftTable: RevisionTable | undefined,
  taint: SourceTableTaint | undefined,
): SourceTable {
  const sourceTable: SourceTable = {
    identity: table.identity,
    pendingGroups: groupsBelowTaint(
      table.groups.map(({ group }) => group),
      taint,
    ),
  };
  if (table.head) {
    sourceTable.head = { ...table.head };
  }
  if (draftTable) {
    sourceTable.draft = {
      tableId: draftTable.id,
      createdId: draftTable.createdId,
    };
  }
  if (taint) {
    sourceTable.taint = { ...taint };
  }
  return sourceTable;
}

function tablesMismatch(
  tableId: string,
  tableIdentity: string | undefined,
  message: string,
): SourceHistoryBlocker {
  const blocker: SourceHistoryBlocker = {
    code: 'SOURCE_TABLES_MISMATCH',
    message,
    tableId,
  };
  if (tableIdentity !== undefined) {
    blocker.tableIdentity = tableIdentity;
  }
  return blocker;
}
