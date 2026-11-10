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
