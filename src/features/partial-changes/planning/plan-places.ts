import type { Row } from 'src/engine-prisma-types';
import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { ChangeCatalogue } from 'src/features/partial-changes/catalogue/change-catalogue';
import {
  type SelectorSide,
  UNIT_KINDS,
  type UnitKind,
} from 'src/features/partial-changes/catalogue/unit';
import { isOnlySchemaHash } from 'src/features/partial-changes/planning/plan-coverage';

export const PLAN_PLACE_KINDS = ['row', 'table', 'sharedSchema'] as const;

export type PlanPlaceKind = (typeof PLAN_PLACE_KINDS)[number];

// A place an operation applies, with the kinds of its applied units and the stored time of its last change: a row's
// Draft version, or the latest of the schema, views or migration rows a table unit holds; null for a row the Draft
// holds no version of, a deleted row (SPEC §9.2).
export type PlanPlace =
  | {
      readonly kind: 'row';
      readonly tableId: string;
      readonly rowId: string;
      readonly side?: SelectorSide;
      readonly units: readonly UnitKind[];
      readonly changedAt: Date | null;
    }
  | {
      readonly kind: 'table';
      readonly tableId: string;
      readonly side?: SelectorSide;
      readonly units: readonly UnitKind[];
      readonly changedAt: Date | null;
    }
  | {
      readonly kind: 'sharedSchema';
      readonly sharedSchemaId: string;
      readonly changedAt: Date | null;
    };

export interface ListedPlaces {
  readonly places: readonly PlanPlace[];
  readonly placesTotal: number;
}

interface PlaceUnits {
  readonly first: CatalogueUnit;
  readonly units: CatalogueUnit[];
}

// The places of the applied units, most recently changed first, places without a time last, ties in unit order; at
// most maxListed of them, with the count of all.
export function listedPlacesOf(
  catalogue: ChangeCatalogue,
  appliedUnits: readonly CatalogueUnit[],
  maxListed: number,
): ListedPlaces {
  const times = new DraftRowTimes(catalogue);
  const places = [...unitsByPlace(appliedUnits).values()]
    .map((place) => placeOf(place, times))
    .sort(compareRecentFirst);

  return { places: places.slice(0, maxListed), placesTotal: places.length };
}

// Row units group by their row selector within their table, as the coverage counts rows; a hidden schemaHash change is
// no place. Table and shared schema units are a place each.
function unitsByPlace(
  appliedUnits: readonly CatalogueUnit[],
): Map<string, PlaceUnits> {
  const byPlace = new Map<string, PlaceUnits>();

  for (const unit of appliedUnits) {
    if (isOnlySchemaHash(unit.unit)) {
      continue;
    }

    const key = placeKeyOf(unit);
    const place = byPlace.get(key);

    if (place) {
      place.units.push(unit);
    } else {
      byPlace.set(key, { first: unit, units: [unit] });
    }
  }

  return byPlace;
}

function placeKeyOf({
  key,
  unit,
  side,
  tableIdentities,
}: CatalogueUnit): string {
  if (unit.rowId === undefined) {
    return key;
  }

  return JSON.stringify([tableIdentities[0], unit.rowId, side ?? null]);
}

function placeOf(
  { first, units }: PlaceUnits,
  times: DraftRowTimes,
): PlanPlace {
  const { unit, side } = first;
  const sided = side === undefined ? {} : { side };

  if (unit.kind === 'sharedSchema') {
    return {
      kind: 'sharedSchema',
      sharedSchemaId: unit.tableId,
      changedAt: latestOf(units.flatMap(({ systemRows }) => systemRows)),
    };
  }

  if (unit.rowId === undefined) {
    return {
      kind: 'table',
      tableId: unit.tableId,
      ...sided,
      units: kindsOf(units),
      changedAt: latestOf(units.flatMap(({ systemRows }) => systemRows)),
    };
  }

  return {
    kind: 'row',
    tableId: unit.tableId,
    rowId: unit.rowId,
    ...sided,
    units: kindsOf(units),
    changedAt: latestOf(units.flatMap((rowUnit) => times.draftRowsOf(rowUnit))),
  };
}

function kindsOf(units: readonly CatalogueUnit[]): UnitKind[] {
  const kinds = new Set(units.map(({ unit }) => unit.kind));

  return UNIT_KINDS.filter((kind) => kinds.has(kind));
}

// A table unit holds Head and Draft system rows; a Head row was written before the Draft copied it, so the latest of
// them is the last change in the Draft, or the last before it when the Draft only removed rows.
function latestOf(rows: readonly Row[]): Date | null {
  let latest: Date | null = null;

  for (const { updatedAt } of rows) {
    if (latest === null || updatedAt > latest) {
      latest = updatedAt;
    }
  }

  return latest;
}

function compareRecentFirst(left: PlanPlace, right: PlanPlace): number {
  if (left.changedAt === null || right.changedAt === null) {
    return Number(left.changedAt === null) - Number(right.changedAt === null);
  }

  return right.changedAt.getTime() - left.changedAt.getTime();
}

// The Draft versions of the rows of a row unit, found by their identities in the changed rows of its table.
class DraftRowTimes {
  private readonly draftRows = new Map<string, Row>();

  constructor({ rows }: ChangeCatalogue) {
    for (const [tableIdentity, tableRows] of rows) {
      for (const { pair } of tableRows) {
        if (pair.draft) {
          this.draftRows.set(keyOf(tableIdentity, pair.identity), pair.draft);
        }
      }
    }
  }

  public draftRowsOf({ tableIdentities, rowIdentities }: CatalogueUnit): Row[] {
    const [tableIdentity] = tableIdentities;

    return rowIdentities.flatMap((rowIdentity) => {
      const row = this.draftRows.get(keyOf(tableIdentity, rowIdentity));

      return row ? [row] : [];
    });
  }
}

function keyOf(tableIdentity: string | undefined, rowIdentity: string): string {
  return JSON.stringify([tableIdentity, rowIdentity]);
}
