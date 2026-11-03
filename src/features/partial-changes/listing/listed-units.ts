import type { CatalogueTables } from 'src/features/partial-changes/catalogue/catalogue-tables';
import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { ChangeCatalogue } from 'src/features/partial-changes/catalogue/change-catalogue';
import type { ListedUnit } from 'src/features/partial-changes/queries/impl/list-draft-changes.query';
import {
  describedUnitRefOf,
  unitRefOf,
} from 'src/features/partial-changes/selection/unit-refs';

type StructuresByTable = ReadonlyMap<string, CatalogueUnit>;

export function listedUnitsOf(
  units: readonly CatalogueUnit[],
  tableLevel: Pick<ChangeCatalogue, 'units' | 'tables'>,
): ListedUnit[] {
  const structures = structuresByTableOf(tableLevel.units);

  return units.map((unit) => listedUnitOf(unit, structures, tableLevel.tables));
}

function listedUnitOf(
  unit: CatalogueUnit,
  structures: StructuresByTable,
  tables: CatalogueTables,
): ListedUnit {
  if (unit.unit.kind === 'structure') {
    return describedUnitRefOf(unit, tables);
  }

  const listed = unitRefOf(unit);
  const structure = structureOfSameTable(unit, structures);

  if (!structure) {
    return listed;
  }

  return { ...listed, structure: unitRefOf(structure) };
}

function structureOfSameTable(
  { tableIdentities }: CatalogueUnit,
  structures: StructuresByTable,
): CatalogueUnit | undefined {
  return tableIdentities
    .map((identity) => structures.get(identity))
    .find((structure) => structure !== undefined);
}

function structuresByTableOf(
  tableUnits: readonly CatalogueUnit[],
): StructuresByTable {
  const structures = new Map<string, CatalogueUnit>();

  for (const tableUnit of tableUnits) {
    if (tableUnit.unit.kind !== 'structure') {
      continue;
    }

    for (const identity of tableUnit.tableIdentities) {
      structures.set(identity, tableUnit);
    }
  }

  return structures;
}
