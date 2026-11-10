import type { RowColumn } from 'src/features/partial-changes/catalogue/unit';
import type { StructureChange } from 'src/features/partial-changes/queries/impl/list-draft-changes.query';
import type {
  DescribedUnitRef,
  UnitRef,
} from 'src/features/partial-changes/selection/unit-refs';

export function structureRef(
  tableId: string,
  previousTableId?: string,
): UnitRef {
  const selector = { structures: [{ tableId }] };

  if (previousTableId === undefined) {
    return { kind: 'structure', tableId, selector };
  }

  return { kind: 'structure', tableId, previousTableId, selector };
}

export function describedStructureRef(
  structureChange: StructureChange,
  tableId: string,
  previousTableId?: string,
): DescribedUnitRef {
  return { ...structureRef(tableId, previousTableId), structureChange };
}

export function fieldRef(
  tableId: string,
  rowId: string,
  path: string,
): UnitRef {
  return {
    kind: 'field',
    tableId,
    rowId,
    path,
    selector: { fields: [{ tableId, rowId, path }] },
  };
}

export function existenceRef(
  kind: 'rowCreate' | 'rowDelete' | 'rowReplace',
  tableId: string,
  rowId: string,
): UnitRef {
  return { kind, tableId, rowId, selector: { rows: [{ tableId, rowId }] } };
}

// A deleted row whose id a rename took over is selected by its Head side.
export function headSideDeletionRef(tableId: string, rowId: string): UnitRef {
  return {
    kind: 'rowDelete',
    tableId,
    rowId,
    side: 'head',
    selector: { rows: [{ tableId, rowId, side: 'head' }] },
  };
}

export function renameRef(
  tableId: string,
  rowId: string,
  previousRowId: string,
): UnitRef {
  return {
    kind: 'rowRename',
    tableId,
    rowId,
    previousRowId,
    selector: { rowRenames: [{ tableId, rowId }] },
  };
}

export function rowColumnsRef(
  tableId: string,
  rowId: string,
  columns: readonly RowColumn[],
): UnitRef {
  return {
    kind: 'rowColumns',
    tableId,
    rowId,
    columns,
    selector: { rowColumns: [{ tableId, rowId }] },
  };
}

export function viewsRef(tableId: string): UnitRef {
  return { kind: 'views', tableId, selector: { views: [tableId] } };
}

export function sharedSchemaRef(sharedSchemaId: string): UnitRef {
  return {
    kind: 'sharedSchema',
    sharedSchemaId,
    selector: { sharedSchemas: [sharedSchemaId] },
  };
}
