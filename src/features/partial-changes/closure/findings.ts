import type { AssemblySource } from 'src/features/partial-changes/assembly/target-assembler';
import type { RefusedTable } from 'src/features/partial-changes/head-schema/head-schema-check';
import {
  type CatalogueBlocker,
  refusalBlocker,
} from 'src/features/partial-changes/plan/plan-blocker';
import {
  type CatalogueReason,
  positionOf,
  type SitePosition,
} from 'src/features/partial-changes/plan/reason';
import type { SelectionSource } from 'src/features/partial-changes/selection/selection-resolution';

export type Finding =
  | {
      readonly kind: 'requires';
      readonly unitKey: string;
      readonly reason: CatalogueReason;
    }
  | { readonly kind: 'blocks'; readonly blocker: CatalogueBlocker };

export type CheckSource = AssemblySource & Pick<SelectionSource, 'headSchema'>;

export function requiring(unitKey: string, reason: CatalogueReason): Finding {
  return { kind: 'requires', unitKey, reason };
}

export function blocking(blocker: CatalogueBlocker): Finding {
  return { kind: 'blocks', blocker };
}

export function refusedBy(refusal: RefusedTable): Finding {
  return blocking(refusalBlocker(refusal));
}

export function requiringOrDangling(
  unitKey: string | undefined,
  reason: CatalogueReason,
  culprit?: string,
): Finding {
  if (unitKey !== undefined) {
    return requiring(unitKey, reason);
  }

  return blocking(
    danglingInSource(reason.because, positionOf(reason.site), culprit),
  );
}

export function danglingInSource(
  because: string,
  { tableId, rowId, path }: SitePosition,
  unitKey: string | undefined,
): CatalogueBlocker {
  const blocker: CatalogueBlocker = {
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
