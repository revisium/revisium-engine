import type { CatalogueTables } from 'src/features/partial-changes/catalogue/catalogue-tables';
import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { ChangeCatalogue } from 'src/features/partial-changes/catalogue/change-catalogue';
import type {
  SelectorSide,
  UnitAddress,
} from 'src/features/partial-changes/catalogue/unit';
import { publicTableIdOf } from 'src/features/partial-changes/snapshot/changes-snapshot';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';

// Rows an operation applies, each counted once, by the kinds of its applied changes as the Draft reads name them; a
// renamed row whose values are applied too counts as renamed and as modified (SPEC §5.1).
export interface RowKindCounts {
  readonly total: number;
  readonly added: number;
  readonly modified: number;
  readonly removed: number;
  readonly renamed: number;
  readonly replaced: number;
  readonly partlyApplied: number;
}

// A row counts as selected when one of its applied units is selected, otherwise as required.
export interface PlanRowCounts {
  readonly selected: RowKindCounts;
  readonly required: RowKindCounts;
}

export interface TableCoverage {
  readonly tableId: string;
  readonly previousTableId?: string;
  readonly side?: SelectorSide;
  readonly structure?: boolean;
  readonly views?: boolean;
  readonly rows: number;
  readonly appliedRows: number;
  readonly partlyAppliedRows: number;
  readonly rowCounts: PlanRowCounts;
}

export interface AppliedUnitKeys {
  readonly applied: ReadonlySet<string>;
  readonly selected: ReadonlySet<string>;
}

type RowKind = Exclude<keyof RowKindCounts, 'total' | 'partlyApplied'>;

const NO_ROWS: RowKindCounts = {
  total: 0,
  added: 0,
  modified: 0,
  removed: 0,
  renamed: 0,
  replaced: 0,
  partlyApplied: 0,
};

const ROW_COUNT_KEYS = Object.keys(NO_ROWS) as (keyof RowKindCounts)[];

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
  keys: AppliedUnitKeys,
): TableCoverage[] {
  return [...unitsByTable(units).values()]
    .filter((table) => table.units.some(({ key }) => keys.applied.has(key)))
    .map((table) => coverageOfTable(table, keys, tables))
    .sort(compareCoverage);
}

export function rowCountsOf(coverage: readonly TableCoverage[]): PlanRowCounts {
  return {
    selected: sumOf(coverage.map(({ rowCounts }) => rowCounts.selected)),
    required: sumOf(coverage.map(({ rowCounts }) => rowCounts.required)),
  };
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
  keys: AppliedUnitKeys,
  tables: CatalogueTables,
): TableCoverage {
  const { applied } = keys;
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
    rowCounts: { selected: NO_ROWS, required: NO_ROWS },
  };
  const rowCounts = { selected: new RowTally(), required: new RowTally() };

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

    countShownRow(rowUnits, keys, rowCounts);
  }

  coverage.rowCounts = {
    selected: rowCounts.selected.counts(),
    required: rowCounts.required.counts(),
  };

  return coverage;
}

// A row counts by its units that the Draft reads show: a rowColumns unit that owns only schemaHash is a technical
// difference no read shows, so a row with nothing else applied is no row, and leaving it out leaves no row partly
// applied. Whether the row is selected is asked of all its applied units, the hidden one included: the caller selected
// the row (SPEC §5.1).
function countShownRow(
  rowUnits: readonly CatalogueUnit[],
  { applied, selected }: AppliedUnitKeys,
  tallies: Record<keyof PlanRowCounts, RowTally>,
): void {
  const appliedUnits = rowUnits.filter(({ key }) => applied.has(key));
  const shown = rowUnits.filter(({ unit }) => !isOnlySchemaHash(unit));
  const appliedShown = shown.filter(({ key }) => applied.has(key));

  if (appliedShown.length === 0) {
    return;
  }

  const group = appliedUnits.some(({ key }) => selected.has(key))
    ? 'selected'
    : 'required';

  tallies[group].add(
    new Set(appliedShown.map(({ unit }) => rowKindOf(unit))),
    appliedShown.length < shown.length,
  );
}

export function isOnlySchemaHash({ kind, columns }: UnitAddress): boolean {
  return (
    kind === 'rowColumns' &&
    columns?.length === 1 &&
    columns[0] === 'schemaHash'
  );
}

function rowKindOf({ kind }: UnitAddress): RowKind {
  switch (kind) {
    case 'rowCreate':
      return 'added';
    case 'rowDelete':
      return 'removed';
    case 'rowReplace':
      return 'replaced';
    case 'rowRename':
      return 'renamed';
    case 'field':
    case 'rowColumns':
      return 'modified';
    default:
      throw new Error(`A ${kind} unit is not a unit of a row`);
  }
}

class RowTally {
  private readonly tally: Mutable<RowKindCounts> = { ...NO_ROWS };

  public add(kinds: ReadonlySet<RowKind>, partly: boolean): void {
    this.tally.total += 1;

    for (const kind of kinds) {
      this.tally[kind] += 1;
    }

    if (partly) {
      this.tally.partlyApplied += 1;
    }
  }

  public counts(): RowKindCounts {
    return { ...this.tally };
  }
}

function sumOf(counts: readonly RowKindCounts[]): RowKindCounts {
  const sum: Mutable<RowKindCounts> = { ...NO_ROWS };

  for (const count of counts) {
    for (const key of ROW_COUNT_KEYS) {
      sum[key] += count[key];
    }
  }

  return sum;
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
