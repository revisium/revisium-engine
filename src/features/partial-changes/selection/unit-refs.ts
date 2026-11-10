import type { CatalogueTables } from 'src/features/partial-changes/catalogue/catalogue-tables';
import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { ChangeCatalogue } from 'src/features/partial-changes/catalogue/change-catalogue';
import { structureChangeOf } from 'src/features/partial-changes/catalogue/structure-changes';
import type {
  SelectorSide,
  Unit,
  UnitAddress,
} from 'src/features/partial-changes/catalogue/unit';
import type {
  CatalogueReason,
  CauseRole,
} from 'src/features/partial-changes/plan/reason';
import type { StructureChange } from 'src/features/partial-changes/queries/impl/list-draft-changes.query';
import type {
  RowRef,
  SelectionItems,
  TableRef,
} from 'src/features/partial-changes/selection/selection';

export type UnitRef = Unit & {
  readonly side?: SelectorSide;
  readonly selector: SelectionItems;
};

export type DescribedUnitRef = UnitRef & {
  readonly structureChange?: StructureChange;
};

export interface ReasonCause {
  readonly unit: DescribedUnitRef;
  readonly role: CauseRole;
}

export type RequiredReason = Omit<CatalogueReason, 'cause'> & {
  readonly cause?: ReasonCause;
};

export interface RequiredUnit {
  readonly unit: DescribedUnitRef;
  readonly reason: RequiredReason;
}

export function unitRefOf({ unit: address, side }: CatalogueUnit): UnitRef {
  const unit = unitOf(address);
  const selector = selectorOf(unit, side);

  if (side === undefined) {
    return { ...unit, selector };
  }

  return { ...unit, side, selector };
}

export function describedUnitRefOf(
  unit: CatalogueUnit,
  tables: CatalogueTables,
): DescribedUnitRef {
  const ref = unitRefOf(unit);

  if (unit.unit.kind !== 'structure') {
    return ref;
  }

  return { ...ref, structureChange: structureChangeOf(unit, tables) };
}

export function requiredUnitsOf(
  catalogue: ChangeCatalogue,
  required: ReadonlyMap<string, CatalogueReason>,
): RequiredUnit[] {
  return catalogue.units.flatMap((unit) => {
    const reason = required.get(unit.key);

    if (!reason) {
      return [];
    }

    return [
      {
        unit: describedUnitRefOf(unit, catalogue.tables),
        reason: requiredReasonOf(catalogue, reason),
      },
    ];
  });
}

export function requiredReasonOf(
  catalogue: ChangeCatalogue,
  { cause, ...reason }: CatalogueReason,
): RequiredReason {
  if (cause === undefined) {
    return reason;
  }

  return {
    ...reason,
    cause: {
      unit: describedUnitRefOfKey(catalogue, cause.unitKey),
      role: cause.role,
    },
  };
}

export function describedUnitRefOfKey(
  { lookup, tables }: ChangeCatalogue,
  unitKey: string,
): DescribedUnitRef {
  return describedUnitRefOf(lookup.unit(unitKey), tables);
}

function unitOf(address: UnitAddress): Unit {
  const { kind, tableId } = address;

  switch (kind) {
    case 'field':
      return {
        kind,
        tableId,
        rowId: requiredPartOf(address, 'rowId'),
        path: requiredPartOf(address, 'path'),
      };
    case 'rowCreate':
    case 'rowDelete':
    case 'rowReplace':
      return { kind, tableId, rowId: requiredPartOf(address, 'rowId') };
    case 'rowRename':
      return {
        kind,
        tableId,
        rowId: requiredPartOf(address, 'rowId'),
        previousRowId: requiredPartOf(address, 'previousRowId'),
      };
    case 'rowColumns':
      return {
        kind,
        tableId,
        rowId: requiredPartOf(address, 'rowId'),
        columns: requiredPartOf(address, 'columns'),
      };
    case 'structure':
      return structureUnitOf(address);
    case 'views':
      return { kind, tableId };
    case 'sharedSchema':
      return { kind, sharedSchemaId: tableId };
  }
}

function structureUnitOf({ tableId, previousTableId }: UnitAddress): Unit {
  if (previousTableId === undefined) {
    return { kind: 'structure', tableId };
  }

  return { kind: 'structure', tableId, previousTableId };
}

function selectorOf(
  unit: Unit,
  side: SelectorSide | undefined,
): SelectionItems {
  switch (unit.kind) {
    case 'field':
      return {
        fields: [{ tableId: unit.tableId, rowId: unit.rowId, path: unit.path }],
      };
    case 'rowCreate':
    case 'rowDelete':
    case 'rowReplace':
      return { rows: [rowRefOf(unit, side)] };
    case 'rowRename':
      return { rowRenames: [rowRefOf(unit, side)] };
    case 'rowColumns':
      return { rowColumns: [rowRefOf(unit, side)] };
    case 'structure':
      return { structures: [tableRefOf(unit, side)] };
    case 'views':
      return { views: [unit.tableId] };
    case 'sharedSchema':
      return { sharedSchemas: [unit.sharedSchemaId] };
  }
}

function rowRefOf(
  { tableId, rowId }: { readonly tableId: string; readonly rowId: string },
  side: SelectorSide | undefined,
): RowRef {
  return sidedRefOf({ tableId, rowId }, side);
}

function tableRefOf(
  { tableId }: { readonly tableId: string },
  side: SelectorSide | undefined,
): TableRef {
  return sidedRefOf({ tableId }, side);
}

function sidedRefOf<Ref extends object>(
  ref: Ref,
  side: SelectorSide | undefined,
): Ref & { readonly side?: SelectorSide } {
  if (side === undefined) {
    return ref;
  }

  return { ...ref, side };
}

function requiredPartOf<
  Part extends 'rowId' | 'path' | 'previousRowId' | 'columns',
>(address: UnitAddress, part: Part): NonNullable<UnitAddress[Part]> {
  const value = address[part];

  if (value === undefined) {
    throw new Error(
      `A ${address.kind} unit of ${address.tableId} has no ${part}`,
    );
  }

  return value as NonNullable<UnitAddress[Part]>;
}
