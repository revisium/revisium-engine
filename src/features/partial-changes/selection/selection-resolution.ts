import type { RefusalCode } from 'src/features/partial-changes/head-schema/head-schema-check';
import type { SelectionItems } from 'src/features/partial-changes/selection/selection';

export type RequiredReasonCode =
  | 'structureBoundData'
  | 'wholeRowUnit'
  | 'atomicValue';

export type BlockerCode =
  | 'notSelectable'
  | 'requiredExcluded'
  | 'unmatchedSelector'
  | RefusalCode;

export interface Reason {
  readonly code: RequiredReasonCode;
  readonly tableId: string;
  readonly rowId?: string;
  readonly path?: string;
  readonly because: string;
}

export interface PlanBlocker {
  readonly code: BlockerCode;
  readonly tableId?: string;
  readonly rowId?: string;
  readonly path?: string;
  readonly message: string;
  readonly unitKey?: string;
  readonly reason?: Reason;
}

export type UnmatchedSelection = SelectionItems & {
  readonly exclude?: SelectionItems;
};

export interface SelectionResolution {
  readonly selected: ReadonlySet<string>;
  readonly excluded: ReadonlySet<string>;
  readonly required: ReadonlyMap<string, Reason>;
  readonly blockers: readonly PlanBlocker[];
  readonly unmatched: UnmatchedSelection;
}
