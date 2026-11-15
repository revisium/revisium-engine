import type { SystemRows } from 'src/features/partial-changes/snapshot/changes-snapshot';
import { SystemTables } from 'src/features/share/system-tables.consts';

export interface EmptyDraftOnlySystemTable {
  readonly tableId: SystemTables;
  readonly draftVersionId: string;
  readonly recreatedWhenMissing: boolean;
}

// Only the views writer creates its system table again when it is missing (ensureSystemTable). The project creates
// the schema, shared-schemas and migration tables, and the native writers that need them fail or skip without them.
const SYSTEM_TABLES_OF_ROWS: readonly (readonly [
  keyof SystemRows,
  SystemTables,
  boolean,
])[] = [
  ['schemas', SystemTables.Schema, false],
  ['migrations', SystemTables.Migration, false],
  ['views', SystemTables.Views, true],
  ['sharedSchemas', SystemTables.SharedSchemas, false],
];

// The system tables that only the Draft holds and that have no rows.
export function emptyDraftOnlySystemTablesOf(
  systemRows: SystemRows,
): EmptyDraftOnlySystemTable[] {
  return SYSTEM_TABLES_OF_ROWS.flatMap(
    ([rowsKey, tableId, recreatedWhenMissing]) => {
      const { versions, draft } = systemRows[rowsKey];

      if (versions.head || !versions.draft || draft.length > 0) {
        return [];
      }

      return [
        {
          tableId,
          draftVersionId: versions.draft.versionId,
          recreatedWhenMissing,
        },
      ];
    },
  );
}
