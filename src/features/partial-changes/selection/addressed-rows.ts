import type { RevisionSide } from 'src/features/draft-revision/commands/impl/target-write-plan';
import {
  PublicIdIndex,
  resolveSide,
} from 'src/features/partial-changes/catalogue/public-id-index';
import type { HeadQualifier } from 'src/features/partial-changes/catalogue/unit';
import type {
  Selection,
  SelectionItems,
} from 'src/features/partial-changes/selection/selection';
import type { ChangesSnapshotReader } from 'src/features/partial-changes/snapshot/changes-snapshot-reader.service';
import type {
  ChangesSnapshot,
  TablePair,
  TableVersion,
} from 'src/features/partial-changes/snapshot/changes-snapshot';

export type ExistingRowIdsReader = Pick<
  ChangesSnapshotReader,
  'readExistingRowIds'
>;

interface AddressedRowId {
  readonly tableId: string;
  readonly rowId: string;
  readonly side?: HeadQualifier;
}

export class AddressedRows {
  constructor(
    private readonly existingRowIds: ReadonlyMap<string, ReadonlySet<string>>,
  ) {}

  public sideOf(
    table: TablePair,
    rowId: string,
    side?: HeadQualifier,
  ): RevisionSide | undefined {
    return resolveSide(side, (revisionSide) =>
      this.exists(table[revisionSide], rowId),
    );
  }

  private exists(version: TableVersion | undefined, rowId: string): boolean {
    return (
      version !== undefined &&
      (this.existingRowIds.get(version.versionId)?.has(rowId) ?? false)
    );
  }
}

export async function readAddressedRows(
  reader: ExistingRowIdsReader,
  snapshot: ChangesSnapshot,
  selection: Selection,
): Promise<AddressedRows> {
  const existingRowIds = new Map<string, ReadonlySet<string>>();
  const addressed = rowIdsByTableVersion(snapshot, selection);

  for (const [tableVersionId, rowIds] of addressed) {
    existingRowIds.set(
      tableVersionId,
      new Set(await reader.readExistingRowIds(tableVersionId, [...rowIds])),
    );
  }

  return new AddressedRows(existingRowIds);
}

function rowIdsByTableVersion(
  snapshot: ChangesSnapshot,
  selection: Selection,
): Map<string, Set<string>> {
  const tables = new PublicIdIndex(snapshot.tables, (pair) => pair);
  const rowIds = new Map<string, Set<string>>();

  for (const { tableId, rowId, side } of addressedRowIdsOf(selection)) {
    for (const version of versionsOf(tablesOfRow(tables, tableId, side))) {
      rowIds.set(
        version.versionId,
        (rowIds.get(version.versionId) ?? new Set()).add(rowId),
      );
    }
  }

  return rowIds;
}

export function tablesOfRow(
  tables: PublicIdIndex<TablePair>,
  tableId: string,
  side: HeadQualifier | undefined,
): TablePair[] {
  if (side === 'head') {
    return distinctTables([
      tables.on('head', tableId),
      tables.on('draft', tableId),
    ]);
  }

  return distinctTables([tables.resolve(tableId)]);
}

function distinctTables(
  tables: readonly (TablePair | undefined)[],
): TablePair[] {
  const byIdentity = new Map<string, TablePair>();

  for (const table of tables) {
    if (table && !byIdentity.has(table.identity)) {
      byIdentity.set(table.identity, table);
    }
  }

  return [...byIdentity.values()];
}

function versionsOf(tables: readonly TablePair[]): TableVersion[] {
  return tables.flatMap(({ head, draft }) =>
    [head, draft].filter((version) => version !== undefined),
  );
}

function addressedRowIdsOf(selection: Selection): AddressedRowId[] {
  return [selection, selection.exclude ?? {}].flatMap(
    (items: SelectionItems) => [
      ...(items.rows ?? []),
      ...(items.renames ?? []),
      ...(items.rowColumns ?? []),
      ...(items.fields ?? []),
    ],
  );
}
