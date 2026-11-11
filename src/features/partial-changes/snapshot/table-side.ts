import type { RevisionSide } from 'src/features/draft-revision/commands/impl/target-write-plan';
import type {
  TablePair,
  TableVersion,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import type {
  TableIdentities,
  TableSide,
} from 'src/features/partial-changes/structure/table-structure';

export type TableIdentitiesBySide = Readonly<
  Record<RevisionSide, TableIdentities>
>;

export function tableIdentitiesOf(
  tables: readonly TablePair[],
): TableIdentitiesBySide {
  const head = new Map<string, string>();
  const draft = new Map<string, string>();

  for (const pair of tables) {
    if (pair.head) {
      head.set(pair.head.id, pair.identity);
    }

    if (pair.draft) {
      draft.set(pair.draft.id, pair.identity);
    }
  }

  return { head, draft };
}

export function tableSideOf(
  tableIdentities: TableIdentitiesBySide,
  version: TableVersion,
  side: RevisionSide,
): TableSide {
  return {
    tableId: version.id,
    schema: version.schema,
    history: version.history,
    tableIdentities: tableIdentities[side],
  };
}
