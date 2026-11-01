import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { ChangeCatalogue } from 'src/features/partial-changes/catalogue/change-catalogue';
import type {
  HeadQualifier,
  Unit,
} from 'src/features/partial-changes/catalogue/unit';
import type {
  RowRef,
  Selection,
  TableRef,
} from 'src/features/partial-changes/selection/selection';
import type { Reason } from 'src/features/partial-changes/selection/selection-resolution';

export type UnitRef = Unit & {
  readonly side?: HeadQualifier;
  readonly selector: Selection;
};

export interface RequiredUnit {
  readonly unit: UnitRef;
  readonly reason: Reason;
}

export function unitRefOf({ unit, side }: CatalogueUnit): UnitRef {
  const selector = selectorOf(unit, side);

  if (side === undefined) {
    return { ...unit, selector };
  }

  return { ...unit, side, selector };
}

export function requiredUnitsOf(
  catalogue: ChangeCatalogue,
  required: ReadonlyMap<string, Reason>,
): RequiredUnit[] {
  return catalogue.units.flatMap((unit) => {
    const reason = required.get(unit.key);

    if (!reason) {
      return [];
    }

    return [{ unit: unitRefOf(unit), reason }];
  });
}

function selectorOf(unit: Unit, side: HeadQualifier | undefined): Selection {
  switch (unit.kind) {
    case 'field':
      return {
        fields: [
          {
            tableId: unit.tableId,
            rowId: rowIdOf(unit),
            path: requiredPartOf(unit, 'path'),
          },
        ],
      };
    case 'rowCreate':
    case 'rowDelete':
    case 'rowReplace':
      return { rows: [rowRefOf(unit, side)] };
    case 'rowRename':
      return { renames: [rowRefOf(unit, side)] };
    case 'rowColumns':
      return { rowColumns: [rowRefOf(unit, side)] };
    case 'structure':
      return { tables: [tableRefOf(unit, side)] };
    case 'views':
      return { views: [unit.tableId] };
    case 'sharedSchema':
      return { sharedSchemas: [unit.tableId] };
  }
}

function rowRefOf(unit: Unit, side: HeadQualifier | undefined): RowRef {
  const ref = { tableId: unit.tableId, rowId: rowIdOf(unit) };

  if (side === undefined) {
    return ref;
  }

  return { ...ref, side };
}

function tableRefOf(
  { tableId }: Unit,
  side: HeadQualifier | undefined,
): TableRef {
  if (side === undefined) {
    return tableId;
  }

  return { tableId, side };
}

function rowIdOf(unit: Unit): string {
  return requiredPartOf(unit, 'rowId');
}

function requiredPartOf(unit: Unit, part: 'rowId' | 'path'): string {
  const value = unit[part];

  if (value === undefined) {
    throw new Error(`A ${unit.kind} unit of ${unit.tableId} has no ${part}`);
  }

  return value;
}
