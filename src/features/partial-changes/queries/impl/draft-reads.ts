import type {
  RefusalCode,
  RefusedTable,
} from 'src/features/partial-changes/head-schema/head-schema-check';
import type {
  DescribedUnitRef,
  UnitRef,
} from 'src/features/partial-changes/selection/unit-refs';
import type { ChangeType } from 'src/features/revision-changes/types';

export interface DraftTableChangesFilters {
  readonly changeTypes?: readonly ChangeType[] | null;
  readonly search?: string | null;
}

export interface DraftReadState {
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
  readonly refusedTables: readonly RefusedTable[];
}

export interface DraftPageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

export interface DraftEdge<T> {
  readonly cursor: string;
  readonly node: T;
}

export interface RefusedSelection {
  readonly state: 'refused';
  readonly code: RefusalCode;
}

export const ROW_SELECTION_STATES = [
  'refused',
  'goesWith',
  'computed',
  'selectable',
] as const;

export type RowSelectionState = (typeof ROW_SELECTION_STATES)[number];

export const FIELD_SELECTION_STATES = [
  'refused',
  'goesWith',
  'computed',
  'unit',
] as const;

export type FieldSelectionState = (typeof FIELD_SELECTION_STATES)[number];

export const GOES_WITH_REASONS = [
  'tableExistence',
  'structureBound',
  'rowExistence',
] as const;

export type GoesWithReason = (typeof GOES_WITH_REASONS)[number];

export const FOLLOW_REASONS = ['referenceRename'] as const;

export type FollowReason = (typeof FOLLOW_REASONS)[number];

export const ID_EXCHANGE_TERMINATIONS = [
  'cycle',
  'freeId',
  'deletedOccupant',
  'truncated',
] as const;

export type IdExchangeTermination = (typeof ID_EXCHANGE_TERMINATIONS)[number];

export interface GoesWithSelection {
  readonly state: 'goesWith';
  readonly unit: DescribedUnitRef;
  readonly reason: GoesWithReason;
}

export interface ComputedSelection {
  readonly state: 'computed';
}

// A field unit, or the unit of the whole array or File value that holds the changed value.
export interface FieldUnitSelection {
  readonly state: 'unit';
  readonly unit: UnitRef;
}

export type FieldSelection =
  | RefusedSelection
  | GoesWithSelection
  | ComputedSelection
  | FieldUnitSelection;
