import type { ChangeOperation } from 'src/features/partial-changes/assembly/outcome-rules';
import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { PlanBlocker } from 'src/features/partial-changes/selection/selection-resolution';

export function structureCommitBlockersOf(
  operation: ChangeOperation,
  appliedUnits: readonly CatalogueUnit[],
): PlanBlocker[] {
  if (operation !== 'commit') {
    return [];
  }

  return appliedUnits
    .filter(({ unit }) => unit.kind === 'structure')
    .map(structureCommitUnavailable);
}

function structureCommitUnavailable({ key, unit }: CatalogueUnit): PlanBlocker {
  const { tableId } = unit;

  return {
    code: 'structureCommitUnavailable',
    tableId,
    message: `Committing the structure of ${tableId} is not available yet; commit its other units or revert the structure`,
    unitKey: key,
  };
}
