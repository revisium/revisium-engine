import type { DraftChangesCatalogueEntry } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';

type RowEntry = DraftChangesCatalogueEntry & {
  kind: 'row';
  target: Extract<DraftChangesCatalogueEntry['target'], { kind: 'row' }>;
};

export function removeRows(
  target: DraftRevisionState,
  entries: RowEntry[],
): void {
  const removedByTable = new Map<string, Set<string>>();
  for (const entry of entries) {
    const ids = removedByTable.get(entry.target.tableCreatedId) ?? new Set();
    ids.add(entry.target.rowCreatedId);
    removedByTable.set(entry.target.tableCreatedId, ids);
  }
  const tables = new Map(
    target.tables.map((table) => [table.createdId, table]),
  );
  for (const [tableId, removed] of removedByTable) {
    const table = tables.get(tableId);
    if (table) {
      table.rows = table.rows.filter((row) => !removed.has(row.createdId));
    }
  }
}

export function copyRows(
  source: DraftRevisionState,
  target: DraftRevisionState,
  entries: RowEntry[],
): void {
  const sourceTables = new Map(
    source.tables.map((table) => [table.createdId, table]),
  );
  const targetTables = new Map(
    target.tables.map((table) => [table.createdId, table]),
  );
  const targetRowsByTable = new Map(
    [...targetTables].map(([tableId, table]) => [
      tableId,
      new Map(table.rows.map((row) => [row.createdId, row])),
    ]),
  );
  const sourceRowsByTable = new Map(
    [...sourceTables].map(([tableId, table]) => [
      tableId,
      new Map(table.rows.map((row) => [row.createdId, row])),
    ]),
  );
  for (const entry of entries) {
    const tableId = entry.target.tableCreatedId;
    const sourceRow = sourceRowsByTable
      .get(tableId)
      ?.get(entry.target.rowCreatedId);
    const targetRows = targetRowsByTable.get(tableId);
    if (!sourceRow || !targetRows) {
      continue;
    }
    targetRows.set(sourceRow.createdId, structuredClone(sourceRow));
  }
  for (const [tableId, rows] of targetRowsByTable) {
    const table = targetTables.get(tableId);
    if (table) {
      table.rows = [...rows.values()];
    }
  }
}

export function renameRows(
  target: DraftRevisionState,
  renames: Array<{ tableCreatedId: string; rowCreatedId: string; id: string }>,
): void {
  const tables = new Map(
    target.tables.map((table) => [table.createdId, table]),
  );
  const rowsByTable = new Map(
    [...tables].map(([tableId, table]) => [
      tableId,
      new Map(table.rows.map((row) => [row.createdId, row])),
    ]),
  );
  for (const rename of renames) {
    const row = rowsByTable
      .get(rename.tableCreatedId)
      ?.get(rename.rowCreatedId);
    if (!row) {
      continue;
    }
    row.id = rename.id;
  }
}
