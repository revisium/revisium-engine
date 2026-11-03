import type { RevisionSide } from 'src/features/draft-revision/commands/impl/target-write-plan';
import type {
  TablePair,
  TableVersion,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { TableSide } from 'src/features/partial-changes/structure/table-structure';

export function tableSideOf(
  tables: readonly TablePair[],
  version: TableVersion,
  side: RevisionSide,
): TableSide {
  const tableIdentities = new Map<string, string>();

  for (const pair of tables) {
    const sideVersion = pair[side];

    if (sideVersion) {
      tableIdentities.set(sideVersion.id, pair.identity);
    }
  }

  return {
    tableId: version.id,
    schema: version.schema,
    history: version.history,
    tableIdentities,
  };
}
