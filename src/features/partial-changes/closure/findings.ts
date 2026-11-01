import type { AppliedUnits } from 'src/features/partial-changes/assembly/outcome-rules';
import type {
  AssembledTarget,
  AssemblySource,
} from 'src/features/partial-changes/assembly/target-assembler';
import type {
  PlanBlocker,
  Reason,
} from 'src/features/partial-changes/selection/selection-resolution';

export type Finding =
  | {
      readonly kind: 'requires';
      readonly unitKey: string;
      readonly reason: Reason;
    }
  | { readonly kind: 'blocks'; readonly blocker: PlanBlocker };

export type Site = Pick<Reason, 'tableId' | 'rowId' | 'path'>;

export const TARGET_CHECKS = Symbol('TARGET_CHECKS');

export interface TargetCheck {
  findingsOf(
    source: AssemblySource,
    target: AssembledTarget,
    choice: AppliedUnits,
  ): Promise<Finding[]>;
}

export function danglingInSource(
  because: string,
  { tableId, rowId, path }: Site,
  unitKey: string | undefined,
): PlanBlocker {
  const blocker: PlanBlocker = {
    code: 'danglingInSource',
    tableId,
    rowId,
    path,
    message: `No unit can restore consistency: ${because}`,
  };

  if (unitKey === undefined) {
    return blocker;
  }

  return { ...blocker, unitKey };
}
