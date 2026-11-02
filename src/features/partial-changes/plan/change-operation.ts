export type ChangeOperation = 'commit' | 'revert';

export interface AppliedUnits {
  readonly operation: ChangeOperation;
  readonly applied: ReadonlySet<string>;
  readonly wholeDraft: boolean;
}

export interface SideNames {
  readonly target: string;
  readonly other: string;
}

const SIDE_NAMES: Readonly<Record<ChangeOperation, SideNames>> = {
  commit: { target: 'new Head', other: 'the Draft' },
  revert: { target: 'reverted Draft', other: 'Head' },
};

export function sideNamesOf(operation: ChangeOperation): SideNames {
  return SIDE_NAMES[operation];
}
