import { previousTableIdOf } from 'src/features/partial-changes/catalogue/catalogue-tables';
import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { ChangeCatalogue } from 'src/features/partial-changes/catalogue/change-catalogue';
import type { SelectorSide } from 'src/features/partial-changes/catalogue/unit';
import {
  publicTableIdOf,
  type TablePair,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
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

interface RowUnits {
  units: number;
  applied: number;
}

// How much of each user table with an applied unit a plan applies (SPEC §5.1). A table is addressed as its units
// address it: the two tables at an id a rename took over have two entries, and a structure unit that holds a removed
// table and the table created at its id has one. Transient structures and shared schemas hold no table.
export function coverageOf(
  { units, tables }: ChangeCatalogue,
  applied: ReadonlySet<string>,
): TableCoverage[] {
  const covered = new CoveredTables((identity) =>
    addressOfPair(tables.pairOf(identity)),
  );

  for (const unit of units) {
    if (unit.unit.kind === 'structure') {
      covered.holdStructure(unit);
    }
  }

  for (const unit of units) {
    covered.add(unit, applied.has(unit.key));
  }

  return covered.coverage();
}

class CoveredTables {
  private readonly tables = new Map<string, CoveredTable>();
  private readonly tableKeysByIdentity = new Map<string, string>();

  constructor(
    private readonly addressOfTable: (identity: string) => TableAddress,
  ) {}

  public holdStructure(unit: CatalogueUnit): void {
    if (unit.tableIdentities.length === 0) {
      return;
    }

    for (const identity of unit.tableIdentities) {
      this.tableKeysByIdentity.set(identity, unit.key);
    }

    this.tables.set(unit.key, new CoveredTable(structureAddressOf(unit)));
  }

  public add(unit: CatalogueUnit, isApplied: boolean): void {
    const [identity] = unit.tableIdentities;

    if (identity !== undefined) {
      this.tableOf(identity).add(unit, isApplied);
    }
  }

  public coverage(): TableCoverage[] {
    return [...this.tables.values()]
      .filter((table) => table.hasAppliedUnit())
      .map((table) => table.coverage())
      .sort(compareCoverage);
  }

  private tableOf(identity: string): CoveredTable {
    const key = this.tableKeysByIdentity.get(identity) ?? identity;
    let table = this.tables.get(key);

    if (!table) {
      table = new CoveredTable(this.addressOfTable(identity));
      this.tables.set(key, table);
    }

    return table;
  }
}

class CoveredTable {
  private structure?: boolean;
  private views?: boolean;
  private hasApplied = false;
  private readonly rows = new Map<string, RowUnits>();

  constructor(private readonly address: TableAddress) {}

  public add({ unit, side }: CatalogueUnit, isApplied: boolean): void {
    this.hasApplied ||= isApplied;

    if (unit.kind === 'structure') {
      this.structure = isApplied;
    } else if (unit.kind === 'views') {
      this.views = isApplied;
    } else if (unit.rowId !== undefined) {
      this.addRowUnit(rowKeyOf(unit.tableId, unit.rowId, side), isApplied);
    }
  }

  public hasAppliedUnit(): boolean {
    return this.hasApplied;
  }

  public coverage(): TableCoverage {
    const coverage: Mutable<TableCoverage> = {
      ...this.address,
      rows: 0,
      appliedRows: 0,
      partlyAppliedRows: 0,
    };

    if (this.structure !== undefined) {
      coverage.structure = this.structure;
    }

    if (this.views !== undefined) {
      coverage.views = this.views;
    }

    for (const { units, applied } of this.rows.values()) {
      coverage.rows += 1;

      if (applied === units) {
        coverage.appliedRows += 1;
      } else if (applied > 0) {
        coverage.partlyAppliedRows += 1;
      }
    }

    return coverage;
  }

  private addRowUnit(rowKey: string, isApplied: boolean): void {
    const row = this.rows.get(rowKey) ?? { units: 0, applied: 0 };
    row.units += 1;

    if (isApplied) {
      row.applied += 1;
    }

    this.rows.set(rowKey, row);
  }
}

function structureAddressOf({ unit, side }: CatalogueUnit): TableAddress {
  return addressOf(unit.tableId, unit.previousTableId, side);
}

function addressOfPair(pair: TablePair): TableAddress {
  return addressOf(publicTableIdOf(pair), previousTableIdOf(pair), undefined);
}

function addressOf(
  tableId: string,
  previousTableId: string | undefined,
  side: SelectorSide | undefined,
): TableAddress {
  const address: Mutable<TableAddress> = { tableId };

  if (previousTableId !== undefined) {
    address.previousTableId = previousTableId;
  }

  if (side !== undefined) {
    address.side = side;
  }

  return address;
}

// A row counts once by its row selector, as the Draft reads count tableData.rows.
function rowKeyOf(
  tableId: string,
  rowId: string,
  side: SelectorSide | undefined,
): string {
  return JSON.stringify([tableId, rowId, side ?? null]);
}

// By table id in code-point order, the side: 'head' entry of an id first.
function compareCoverage(left: TableCoverage, right: TableCoverage): number {
  return (
    compareCodePoints(left.tableId, right.tableId) ||
    Number(right.side === 'head') - Number(left.side === 'head')
  );
}
