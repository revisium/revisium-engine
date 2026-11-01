import type { PlanBlocker } from 'src/features/partial-changes/selection/selection-resolution';

export function changedRowsTooLarge(
  changedRows: number,
  maxChangedRows: number,
): PlanBlocker {
  return {
    code: 'tooLarge',
    message: `The affected tables hold ${changedRows} changed rows; the limit for one operation is ${maxChangedRows}`,
  };
}
