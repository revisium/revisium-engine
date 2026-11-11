import { CatalogueLookup } from 'src/features/partial-changes/catalogue/catalogue-lookup';
import { CatalogueTables } from 'src/features/partial-changes/catalogue/catalogue-tables';
import type {
  CatalogueRow,
  CatalogueUnit,
} from 'src/features/partial-changes/catalogue/catalogue-unit';
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
  HeadSchemaCheck,
  RefusedTable,
} from 'src/features/partial-changes/head-schema/head-schema-check';
import {
  type ChangedRows,
  type ComparedTable,
  versionOn,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { ComparedSnapshot } from 'src/features/partial-changes/snapshot/compared-snapshot-reader.service';

export interface ChangeCatalogue {
  readonly units: readonly CatalogueUnit[];
  readonly rows: ReadonlyMap<string, readonly CatalogueRow[]>;
  readonly lookup: CatalogueLookup;
  readonly tables: CatalogueTables;
  readonly ledgerInconsistencies: readonly LedgerInconsistency[];
  readonly refusedTables: readonly RefusedTable[];
}

export interface CatalogueSource extends ComparedSnapshot {
  readonly changedRows: ChangedRows;
}

interface RowUnitsOfTables {
  readonly units: readonly CatalogueUnit[];
  readonly rows: ReadonlyMap<string, readonly CatalogueRow[]>;
}

export function buildChangeCatalogue(source: CatalogueSource): ChangeCatalogue {
  const tables = new CatalogueTables(source.snapshot, source.tables);
  const rowUnits = buildRowUnitsOfChangedTables(source, tables);
  const tableUnits = [
    ...buildStructureUnits(tables, source.ledger),
    ...buildViewsUnits(tables),
  ];
  const units = [
    ...tableUnits.filter((unit) => !holdsRefusedTable(unit, source.headSchema)),
    ...buildSharedSchemaUnits(source.snapshot.systemRows.sharedSchemas),
    ...rowUnits.units,
  ].sort(compareUnits);

  return {
    units,
    rows: rowUnits.rows,
    lookup: new CatalogueLookup(units, rowUnits.rows),
    tables,
    ledgerInconsistencies: ledgerInconsistenciesOf(tables, source.ledger),
    refusedTables: source.headSchema.refusedTables,
  };
}

function buildRowUnitsOfChangedTables(
  source: CatalogueSource,
  tables: CatalogueTables,
): RowUnitsOfTables {
  const units: CatalogueUnit[] = [];
  const rows = new Map<string, readonly CatalogueRow[]>();

  for (const table of tablesNotRefused(source)) {
    const pairs = source.changedRows.get(table.identity);

    if (!pairs) {
      continue;
    }

    const rowUnits = buildRowUnits({
      identity: table.identity,
      tableId: versionOn(tables.pairOf(table.identity), 'draft').id,
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

function tablesNotRefused({
  tables,
  headSchema,
}: CatalogueSource): ComparedTable[] {
  return tables.filter(
    ({ identity }) => !headSchema.refusedTablesByIdentity.has(identity),
  );
}

function holdsRefusedTable(
  unit: CatalogueUnit,
  headSchema: HeadSchemaCheck,
): boolean {
  return unit.tableIdentities.some((identity) =>
    headSchema.refusedTablesByIdentity.has(identity),
  );
}
