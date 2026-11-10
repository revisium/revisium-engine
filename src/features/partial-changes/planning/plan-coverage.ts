import type { CatalogueTables } from 'src/features/partial-changes/catalogue/catalogue-tables';
import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { ChangeCatalogue } from 'src/features/partial-changes/catalogue/change-catalogue';
import type { SelectorSide } from 'src/features/partial-changes/catalogue/unit';
import { publicTableIdOf } from 'src/features/partial-changes/snapshot/changes-snapshot';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';

export interface TableCoverage {
  readonly tableId: string;
  readonly previousTableId?: string;
  readonly side?: SelectorSide;
  readonly structure?: boolean;
  readonly views?: boolean;
  readonly rows: number;
  readonly appliedRows: number;
  readonly partlyAppliedRows: number;
}

type Mutable<Type> = { -readonly [Key in keyof Type]: Type[Key] };

type TableAddress = Pick<TableCoverage, 'tableId' | 'previousTableId' | 'side'>;

interface TableUnits {
  readonly identity: string;
  readonly units: CatalogueUnit[];
}

// How much of each user table with an applied unit a plan applies (SPEC §5.1). A table is addressed as its units
// address it: its structure unit gives the address when it has one, so the two tables at an id a rename took over
// have two entries, and a structure unit that holds a removed table and the table created at its id has one.
// Transient structures and shared schemas hold no table and have no entry.
export function coverageOf(
  { units, tables }: ChangeCatalogue,
  applied: ReadonlySet<string>,
): TableCoverage[] {
  return [...unitsByTable(units).values()]
    .filter((table) => table.units.some(({ key }) => applied.has(key)))
    .map((table) => coverageOfTable(table, applied, tables))
    .sort(compareCoverage);
}

// The units of each table, keyed by the structure unit that holds the table, else by the table identity.
function unitsByTable(
  units: readonly CatalogueUnit[],
): Map<string, TableUnits> {
  const structureKeys = new Map<string, string>();

  for (const unit of units) {
    if (unit.unit.kind === 'structure') {
      for (const identity of unit.tableIdentities) {
        structureKeys.set(identity, unit.key);
      }
    }
  }

  const byTable = new Map<string, TableUnits>();

  for (const unit of units) {
    const [identity] = unit.tableIdentities;

    if (identity === undefined) {
      continue;
    }

    const key = structureKeys.get(identity) ?? identity;
    const table = byTable.get(key);

    if (table) {
      table.units.push(unit);
    } else {
      byTable.set(key, { identity, units: [unit] });
    }
  }

  return byTable;
}

function coverageOfTable(
  { identity, units }: TableUnits,
  applied: ReadonlySet<string>,
  tables: CatalogueTables,
): TableCoverage {
  const structure = units.find(({ unit }) => unit.kind === 'structure');
  const views = units.find(({ unit }) => unit.kind === 'views');
  // A table without a structure unit keeps its id: a rename is a structure change.
  const address = structure
    ? structureAddressOf(structure)
    : { tableId: publicTableIdOf(tables.pairOf(identity)) };
  const coverage: Mutable<TableCoverage> = {
    ...address,
    rows: 0,
    appliedRows: 0,
    partlyAppliedRows: 0,
  };

  if (structure) {
    coverage.structure = applied.has(structure.key);
  }

  if (views) {
    coverage.views = applied.has(views.key);
  }

  for (const rowUnits of unitsByRow(units).values()) {
    const appliedUnits = rowUnits.filter(({ key }) => applied.has(key));
    coverage.rows += 1;

    if (appliedUnits.length === rowUnits.length) {
      coverage.appliedRows += 1;
    } else if (appliedUnits.length > 0) {
      coverage.partlyAppliedRows += 1;
    }
  }

  return coverage;
}

function structureAddressOf({ unit, side }: CatalogueUnit): TableAddress {
  const address: Mutable<TableAddress> = { tableId: unit.tableId };

  if (unit.previousTableId !== undefined) {
    address.previousTableId = unit.previousTableId;
  }

  if (side !== undefined) {
    address.side = side;
  }

  return address;
}

// A row counts once by its row selector, as the Draft reads count tableData.rows: by its id and its side.
function unitsByRow(
  units: readonly CatalogueUnit[],
): Map<string, CatalogueUnit[]> {
  const byRow = new Map<string, CatalogueUnit[]>();

  for (const unit of units) {
    const { rowId } = unit.unit;

    if (rowId === undefined) {
      continue;
    }

    const key = JSON.stringify([rowId, unit.side ?? null]);
    const row = byRow.get(key);

    if (row) {
      row.push(unit);
    } else {
      byRow.set(key, [unit]);
    }
  }

  return byRow;
}

// By table id in code-point order, the side: 'head' entry of an id first.
function compareCoverage(left: TableCoverage, right: TableCoverage): number {
  return (
    compareCodePoints(left.tableId, right.tableId) ||
    Number(right.side === 'head') - Number(left.side === 'head')
  );
}
