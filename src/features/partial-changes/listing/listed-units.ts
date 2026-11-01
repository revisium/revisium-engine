import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { Unit } from 'src/features/partial-changes/catalogue/unit';
import type { ListedUnit } from 'src/features/partial-changes/queries/impl/list-draft-changes.query';
import { unitRefOf } from 'src/features/partial-changes/selection/unit-refs';

type StructuresByTable = ReadonlyMap<string, Unit>;

export function listedUnitsOf(
  units: readonly CatalogueUnit[],
  tableUnits: readonly CatalogueUnit[],
): ListedUnit[] {
  const structures = structuresByTableOf(tableUnits);

  return units.map((unit) => listedUnitOf(unit, structures));
}

function listedUnitOf(
  unit: CatalogueUnit,
  structures: StructuresByTable,
): ListedUnit {
  const listed = unitRefOf(unit);
  const structure = structureOfSameTable(unit, structures);

  if (!structure) {
    return listed;
  }

  return { ...listed, structure };
}

function structureOfSameTable(
  { unit, tableIdentities }: CatalogueUnit,
  structures: StructuresByTable,
): Unit | undefined {
  if (unit.kind === 'structure') {
    return undefined;
  }

  return tableIdentities
    .map((identity) => structures.get(identity))
    .find((structure) => structure !== undefined);
}

function structuresByTableOf(
  tableUnits: readonly CatalogueUnit[],
): StructuresByTable {
  const structures = new Map<string, Unit>();

  for (const { unit, tableIdentities } of tableUnits) {
    if (unit.kind !== 'structure') {
      continue;
    }

    for (const identity of tableIdentities) {
      structures.set(identity, unit);
    }
  }

  return structures;
}
