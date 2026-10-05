import type { DraftChangesCatalogueEntry } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import { SystemTables } from 'src/features/share/system-tables.consts';
import {
  copySchemaRow,
  findTable,
  removeTable,
  replaceTable,
} from './candidate-state';

type TableEntry = DraftChangesCatalogueEntry & {
  kind: 'table';
  target: Extract<DraftChangesCatalogueEntry['target'], { kind: 'table' }>;
};

export function removeTables(
  target: DraftRevisionState,
  entries: TableEntry[],
): void {
  for (const entry of entries) {
    removeTable(target, entry.target.tableCreatedId);
  }
}

export function copyTables(
  source: DraftRevisionState,
  target: DraftRevisionState,
  entries: TableEntry[],
): void {
  for (const entry of entries) {
    const sourceTable = findTable(source, entry.target.tableCreatedId);
    if (!sourceTable) {
      continue;
    }
    const table = structuredClone(sourceTable);
    table.rows = [];
    replaceTable(target, table);
    copySchemaRow(target, source, entry.target.tableCreatedId);
  }
}

export function renameTables(
  target: DraftRevisionState,
  renames: Array<{ tableCreatedId: string; id: string }>,
): void {
  const schemaTable = target.tables.find(
    ({ id }) => id === SystemTables.Schema,
  );
  const bindings = renames.map(({ tableCreatedId, id }) => {
    const table = findTable(target, tableCreatedId);
    const schemaRow = schemaTable?.rows.find(({ id }) => id === table?.id);
    return { table, schemaRow, id };
  });
  for (const binding of bindings) {
    if (!binding.table) {
      continue;
    }
    binding.table.id = binding.id;
    if (binding.schemaRow) {
      binding.schemaRow.id = binding.id;
    }
  }
}
