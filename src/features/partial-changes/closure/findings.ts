import type {
  AppliedUnits,
  ChangeOperation,
} from 'src/features/partial-changes/assembly/outcome-rules';
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
  checkingOf(source: AssemblySource): TargetChecking;
}

export interface TargetChecking {
  findingsOf(target: AssembledTarget, choice: AppliedUnits): Promise<Finding[]>;
}

export interface SideNames {
  readonly target: string;
  readonly other: string;
}

const SIDE_NAMES: Readonly<Record<ChangeOperation, SideNames>> = {
  commit: { target: 'new Head', other: 'the Draft' },
  revert: { target: 'reverted Draft', other: 'Head' },
};

export function requiring(unitKey: string, reason: Reason): Finding {
  return { kind: 'requires', unitKey, reason };
}

export function blocking(blocker: PlanBlocker): Finding {
  return { kind: 'blocks', blocker };
}

export function requiringOrDangling(
  unitKey: string | undefined,
  reason: Reason,
  culprit?: string,
): Finding {
  if (unitKey !== undefined) {
    return requiring(unitKey, reason);
  }

  return blocking(danglingInSource(reason.because, reason, culprit));
}

export function sideNamesOf(operation: ChangeOperation): SideNames {
  return SIDE_NAMES[operation];
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
