import type {
  CatalogueRow,
  CatalogueUnit,
} from 'src/features/partial-changes/catalogue/catalogue-unit';
import { buildRowUnits } from 'src/features/partial-changes/catalogue/row-units';
import { compareUnits } from 'src/features/partial-changes/catalogue/unit-order';
import type {
  ChangedRows,
  ChangesSnapshot,
  ComparedTable,
} from 'src/features/partial-changes/snapshot/changes-snapshot';

export interface ChangeCatalogue {
  readonly units: readonly CatalogueUnit[];
  readonly rows: ReadonlyMap<string, readonly CatalogueRow[]>;
}

export interface CatalogueSource {
  readonly snapshot: ChangesSnapshot;
  readonly tables: readonly ComparedTable[];
  readonly changedRows: ChangedRows;
}

export function buildChangeCatalogue(source: CatalogueSource): ChangeCatalogue {
  const draftTableIds = draftTableIdsOf(source.snapshot);
  const units: CatalogueUnit[] = [];
  const rows = new Map<string, readonly CatalogueRow[]>();

  for (const table of source.tables) {
    const rowUnits = buildRowUnits({
      identity: table.identity,
      tableId: draftTableIdOf(draftTableIds, table.identity),
      structure: table.structure,
      pairs: source.changedRows.get(table.identity) ?? [],
    });

    for (const unit of rowUnits.units) {
      units.push(unit);
    }

    rows.set(table.identity, rowUnits.rows);
  }

  return { units: units.sort(compareUnits), rows };
}

function draftTableIdsOf(
  snapshot: ChangesSnapshot,
): ReadonlyMap<string, string> {
  const tableIds = new Map<string, string>();

  for (const { identity, draft } of snapshot.tables) {
    if (draft) {
      tableIds.set(identity, draft.id);
    }
  }

  return tableIds;
}

function draftTableIdOf(
  draftTableIds: ReadonlyMap<string, string>,
  identity: string,
): string {
  const tableId = draftTableIds.get(identity);

  if (tableId === undefined) {
    throw new Error(`Table ${identity} is not in the Draft`);
  }

  return tableId;
}
