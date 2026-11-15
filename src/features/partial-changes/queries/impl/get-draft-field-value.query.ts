import type { DraftReadState } from 'src/features/partial-changes/queries/impl/draft-reads';
import type { ChangesBranch } from 'src/features/partial-changes/snapshot/changes-snapshot';

// The revision a value is read from.
export const DRAFT_VALUE_SIDES = ['head', 'draft'] as const;

export type DraftValueSide = (typeof DRAFT_VALUE_SIDES)[number];

export interface DraftFieldValueInput {
  readonly branch: ChangesBranch;
  readonly tableId: string;
  readonly rowId: string;
  readonly path: string;
  readonly side: DraftValueSide;
  readonly offset?: number | null;
  readonly limit?: number | null;
}

// Where the returned part of a string starts, in UTF-16 code units, and the length of the whole string.
export interface DraftTextRange {
  readonly offset: number;
  readonly totalLength: number;
}

export interface DraftFieldValue extends DraftReadState {
  readonly value: unknown;
  readonly valueBytes: number | null;
  // The token of the whole value's content: equal for every range of one value, another one after it changed.
  readonly valueToken: string | null;
  readonly text?: DraftTextRange;
}

export class GetDraftFieldValueQuery {
  constructor(public readonly data: DraftFieldValueInput) {}
}
