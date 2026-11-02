import type { AssemblySource } from 'src/features/partial-changes/assembly/target-assembler';
import type { RefusedTable } from 'src/features/partial-changes/head-schema/head-schema-check';
import {
  type PlanBlocker,
  refusalBlocker,
} from 'src/features/partial-changes/plan/plan-blocker';
import type { Reason } from 'src/features/partial-changes/plan/reason';
import type { SelectionSource } from 'src/features/partial-changes/selection/selection-resolution';

export type Finding =
  | {
      readonly kind: 'requires';
      readonly unitKey: string;
      readonly reason: Reason;
    }
  | { readonly kind: 'blocks'; readonly blocker: PlanBlocker };

export type Site = Pick<Reason, 'tableId' | 'rowId' | 'path'>;

export type CheckSource = AssemblySource & Pick<SelectionSource, 'headSchema'>;

export function requiring(unitKey: string, reason: Reason): Finding {
  return { kind: 'requires', unitKey, reason };
}

export function blocking(blocker: PlanBlocker): Finding {
  return { kind: 'blocks', blocker };
}

export function refusedBy(refusal: RefusedTable): Finding {
  return blocking(refusalBlocker(refusal));
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
