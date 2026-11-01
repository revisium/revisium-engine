import type { Estimate } from 'src/features/partial-changes/limits/operation-estimator';
import type { PartialChangesLimits } from 'src/features/partial-changes/limits/partial-changes-limits';
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

export function estimateTooLarge(
  { perRowWorkRows, mixedTables }: Estimate,
  { maxPerRowWork, maxMixedTableLinks }: PartialChangesLimits,
): PlanBlocker[] {
  const blockers = mixedTables
    .filter(({ linksCopied }) => linksCopied > maxMixedTableLinks)
    .map(
      ({ tableId, linksCopied }): PlanBlocker => ({
        code: 'tooLarge',
        tableId,
        message: `Assembling ${tableId} copies ${linksCopied} row links; the limit for one table is ${maxMixedTableLinks}`,
      }),
    );

  if (perRowWorkRows <= maxPerRowWork) {
    return blockers;
  }

  return [
    {
      code: 'tooLarge',
      message: `The operation merges ${perRowWorkRows} rows that need per-row work (formula fields or file registration); the limit for one operation is ${maxPerRowWork}`,
    },
    ...blockers,
  ];
}
