import { CatalogueTables } from 'src/features/partial-changes/catalogue/catalogue-tables';
import type {
  CatalogueRow,
  CatalogueUnit,
} from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { ChangeCatalogue } from 'src/features/partial-changes/catalogue/change-catalogue';
import type {
  Side,
  UnitKind,
} from 'src/features/partial-changes/catalogue/unit';
import type {
  HeadSchemaCheck,
  RefusedTable,
} from 'src/features/partial-changes/head-schema/head-schema-check';
import { PublicIdIndex } from 'src/features/partial-changes/selection/public-id-index';
import type {
  ChangesSnapshot,
  ComparedTable,
  TablePair,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { TableStructure } from 'src/features/partial-changes/structure/table-structure';

export interface SelectionSource {
  readonly snapshot: ChangesSnapshot;
  readonly headSchema: HeadSchemaCheck;
  readonly tables: readonly ComparedTable[];
  readonly catalogue: ChangeCatalogue;
}

const TABLE_LEVEL_KINDS: ReadonlySet<UnitKind> = new Set([
  'structure',
  'views',
]);

export class CatalogueLookup {
  private readonly tables: PublicIdIndex<TablePair>;
  private readonly structures: CatalogueTables;
  private readonly rows = new Map<string, PublicIdIndex<CatalogueRow>>();
  private readonly unitsByKey = new Map<string, CatalogueUnit>();
  private readonly tableLevelUnits = new Map<string, CatalogueUnit[]>();
  private readonly rowLevelUnits = new Map<string, CatalogueUnit[]>();
  private readonly unitsWithoutTable = new Map<string, CatalogueUnit[]>();

  constructor(private readonly source: SelectionSource) {
    this.tables = new PublicIdIndex(source.snapshot.tables, (pair) => pair);
    this.structures = new CatalogueTables(source.snapshot, source.tables);

    for (const [identity, rows] of source.catalogue.rows) {
      this.rows.set(identity, new PublicIdIndex(rows, ({ pair }) => pair));
    }

    for (const unit of source.catalogue.units) {
      this.index(unit);
    }
  }

  public tableNamed(tableId: string, side?: Side): TablePair | undefined {
    return this.tables.resolve(tableId, side);
  }

  public refusalsNaming(tableId: string): RefusedTable[] {
    return this.tables.holding(tableId).flatMap(({ identity }) => {
      const refused =
        this.source.headSchema.refusedTablesByIdentity.get(identity);

      return refused ? [refused] : [];
    });
  }

  public structureOf(table: TablePair): TableStructure {
    return this.structures.structureOf(table);
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

  public rowNamed(
    { identity }: TablePair,
    rowId: string,
    side?: Side,
  ): CatalogueRow | undefined {
    return this.rows.get(identity)?.resolve(rowId, side);
  }

  public unitsOfRow(row: CatalogueRow): CatalogueUnit[] {
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
    if (TABLE_LEVEL_KINDS.has(kind)) {
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
