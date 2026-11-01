import type {
  CatalogueRow,
  CatalogueUnit,
} from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { ChangeCatalogue } from 'src/features/partial-changes/catalogue/change-catalogue';
import type { UnitKind } from 'src/features/partial-changes/catalogue/unit';
import { PublicIdIndex } from 'src/features/partial-changes/selection/public-id-index';
import type { AddressedRow } from 'src/features/partial-changes/selection/selection-targets';
import type { TablePair } from 'src/features/partial-changes/snapshot/changes-snapshot';

const TABLE_UNIT_KINDS: ReadonlySet<UnitKind> = new Set(['structure', 'views']);

export class CatalogueLookup {
  private readonly rows = new Map<string, PublicIdIndex<CatalogueRow>>();
  private readonly unitsByKey = new Map<string, CatalogueUnit>();
  private readonly tableLevelUnits = new Map<string, CatalogueUnit[]>();
  private readonly rowLevelUnits = new Map<string, CatalogueUnit[]>();
  private readonly unitsWithoutTable = new Map<string, CatalogueUnit[]>();

  constructor(catalogue: ChangeCatalogue) {
    for (const [identity, rows] of catalogue.rows) {
      this.rows.set(identity, new PublicIdIndex(rows, ({ pair }) => pair));
    }

    for (const unit of catalogue.units) {
      this.index(unit);
    }
  }

  public tableUnitOf(
    kind: 'structure' | 'views',
    { identity }: TablePair,
  ): CatalogueUnit | undefined {
    return this.tableLevelUnits
      .get(identity)
      ?.find(({ unit }) => unit.kind === kind);
  }

  public unitWithoutTable(
    kind: 'structure' | 'sharedSchema',
    id: string,
  ): CatalogueUnit | undefined {
    return this.unitsWithoutTable
      .get(id)
      ?.find(({ unit }) => unit.kind === kind);
  }

  public rowLevelUnitsOf({ identity }: TablePair): readonly CatalogueUnit[] {
    return this.rowLevelUnits.get(identity) ?? [];
  }

  public unitsOfRow({ table, rowId, side }: AddressedRow): CatalogueUnit[] {
    const row = this.rows.get(table.identity)?.on(side, rowId);

    if (!row) {
      return [];
    }

    const keys = new Set([
      row.existence,
      ...row.columns.values(),
      ...row.leaves.values(),
    ]);

    return [...keys]
      .filter((key): key is string => key !== undefined)
      .map((key) => this.unit(key))
      .filter(({ unit }) => unit.kind !== 'structure');
  }

  public unit(key: string): CatalogueUnit {
    const unit = this.unitsByKey.get(key);

    if (!unit) {
      throw new Error(`The catalogue has no unit ${key}`);
    }

    return unit;
  }

  private index(catalogueUnit: CatalogueUnit): void {
    const { key, tableIdentities, unit } = catalogueUnit;

    this.unitsByKey.set(key, catalogueUnit);

    if (tableIdentities.length === 0) {
      addTo(this.unitsWithoutTable, unit.tableId, catalogueUnit);

      return;
    }

    for (const identity of tableIdentities) {
      addTo(this.unitsOfTablesFor(unit.kind), identity, catalogueUnit);
    }
  }

  private unitsOfTablesFor(kind: UnitKind): Map<string, CatalogueUnit[]> {
    if (TABLE_UNIT_KINDS.has(kind)) {
      return this.tableLevelUnits;
    }

    return this.rowLevelUnits;
  }
}

function addTo(
  units: Map<string, CatalogueUnit[]>,
  key: string,
  unit: CatalogueUnit,
): void {
  const existing = units.get(key);

  if (existing) {
    existing.push(unit);
  } else {
    units.set(key, [unit]);
  }
}
