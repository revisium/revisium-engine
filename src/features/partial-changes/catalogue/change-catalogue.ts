import { CatalogueTables } from 'src/features/partial-changes/catalogue/catalogue-tables';
import type {
  CatalogueRow,
  CatalogueUnit,
} from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { HeadViewsMigration } from 'src/features/partial-changes/catalogue/head-views-migration';
import type { LedgerAttribution } from 'src/features/partial-changes/catalogue/ledger-attribution';
import {
  type LedgerInconsistency,
  ledgerInconsistenciesOf,
} from 'src/features/partial-changes/catalogue/ledger-inconsistency';
import { buildRowUnits } from 'src/features/partial-changes/catalogue/row-units';
import { buildSharedSchemaUnits } from 'src/features/partial-changes/catalogue/shared-schema-units';
import { buildStructureUnits } from 'src/features/partial-changes/catalogue/structure-units';
import { compareUnits } from 'src/features/partial-changes/catalogue/unit-order';
import { buildViewsUnits } from 'src/features/partial-changes/catalogue/views-units';
import type {
  ChangedRows,
  ChangesSnapshot,
  ComparedTable,
} from 'src/features/partial-changes/snapshot/changes-snapshot';

export interface ChangeCatalogue {
  readonly units: readonly CatalogueUnit[];
  readonly rows: ReadonlyMap<string, readonly CatalogueRow[]>;
  readonly ledgerInconsistencies: readonly LedgerInconsistency[];
}

export interface CatalogueSource {
  readonly snapshot: ChangesSnapshot;
  readonly ledger: LedgerAttribution;
  readonly tables: readonly ComparedTable[];
  readonly changedRows: ChangedRows;
}

interface RowUnitsOfTables {
  readonly units: readonly CatalogueUnit[];
  readonly rows: ReadonlyMap<string, readonly CatalogueRow[]>;
}

export function buildChangeCatalogue(
  source: CatalogueSource,
  headViews: HeadViewsMigration,
): ChangeCatalogue {
  const tables = new CatalogueTables(source.snapshot, source.tables);
  const rowUnits = buildRowUnitsOfChangedTables(source);
  const units = [
    ...buildStructureUnits(tables, source.ledger),
    ...buildViewsUnits(tables, headViews),
    ...buildSharedSchemaUnits(source.snapshot.systemRows.sharedSchemas),
    ...rowUnits.units,
  ];

  return {
    units: units.sort(compareUnits),
    rows: rowUnits.rows,
    ledgerInconsistencies: ledgerInconsistenciesOf(tables, source.ledger),
  };
}

function buildRowUnitsOfChangedTables(
  source: CatalogueSource,
): RowUnitsOfTables {
  const draftTableIds = draftTableIdsOf(source.snapshot);
  const units: CatalogueUnit[] = [];
  const rows = new Map<string, readonly CatalogueRow[]>();

  for (const table of source.tables) {
    const pairs = source.changedRows.get(table.identity);

    if (!pairs) {
      continue;
    }

    const rowUnits = buildRowUnits({
      identity: table.identity,
      tableId: draftTableIdOf(draftTableIds, table.identity),
      structure: table.structure,
      pairs,
    });

    for (const unit of rowUnits.units) {
      units.push(unit);
    }

    rows.set(table.identity, rowUnits.rows);
  }

  return { units, rows };
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
