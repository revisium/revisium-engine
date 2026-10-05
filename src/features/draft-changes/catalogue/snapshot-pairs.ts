import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type { DraftChangesIdentityBinding } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';

export type SnapshotTable = DraftChangesSnapshot['head']['tables'][number];
export type SnapshotRow = SnapshotTable['rows'][number];

export interface TablePair {
  createdId: string;
  head?: SnapshotTable;
  draft?: SnapshotTable;
}

export type SnapshotPairResult =
  | { pairs: TablePair[]; identityBindings: DraftChangesIdentityBinding[] }
  | { blocker: string };

export function pairSnapshotTables(
  snapshot: DraftChangesSnapshot,
): SnapshotPairResult {
  const head = uniqueTables(snapshot.head.tables);
  const draft = uniqueTables(snapshot.draft.tables);
  if (!head || !draft) {
    return { blocker: 'Snapshot contains duplicate stable table identities.' };
  }
  const ids = [...new Set([...head.keys(), ...draft.keys()])].sort(
    compareStrings,
  );
  const pairs = ids.map((createdId) => ({
    createdId,
    head: head.get(createdId),
    draft: draft.get(createdId),
  }));
  const identityBindings = pairs.map(
    ({ createdId, head: before, draft: after }) => ({
      kind: 'table' as const,
      tableCreatedId: createdId,
      entityCreatedId: createdId,
      headIds: before ? [before.id] : [],
      draftIds: after ? [after.id] : [],
    }),
  );
  return { pairs, identityBindings };
}

export function pairSnapshotRows(
  tableCreatedId: string,
  headRows: SnapshotRow[],
  draftRows: SnapshotRow[],
):
  | {
      pairs: Array<{
        createdId: string;
        head?: SnapshotRow;
        draft?: SnapshotRow;
      }>;
      bindings: DraftChangesIdentityBinding[];
    }
  | { blocker: string } {
  const head = uniqueRows(headRows);
  const draft = uniqueRows(draftRows);
  if (!head || !draft) {
    return {
      blocker: `Table '${tableCreatedId}' contains duplicate stable row identities.`,
    };
  }
  const ids = [...new Set([...head.keys(), ...draft.keys()])].sort(
    compareStrings,
  );
  const pairs = ids.map((createdId) => ({
    createdId,
    head: head.get(createdId),
    draft: draft.get(createdId),
  }));
  const bindings = pairs.map(({ createdId, head: before, draft: after }) => ({
    kind: 'row' as const,
    tableCreatedId,
    entityCreatedId: createdId,
    headIds: before ? [before.id] : [],
    draftIds: after ? [after.id] : [],
  }));
  return { pairs, bindings };
}

function uniqueTables(
  tables: SnapshotTable[],
): Map<string, SnapshotTable> | undefined {
  const result = new Map<string, SnapshotTable>();
  for (const table of tables.filter(({ system }) => !system)) {
    if (result.has(table.createdId)) {
      return undefined;
    }
    result.set(table.createdId, table);
  }
  return result;
}

function uniqueRows(rows: SnapshotRow[]): Map<string, SnapshotRow> | undefined {
  const result = new Map<string, SnapshotRow>();
  for (const row of rows) {
    if (result.has(row.createdId)) {
      return undefined;
    }
    result.set(row.createdId, row);
  }
  return result;
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}
