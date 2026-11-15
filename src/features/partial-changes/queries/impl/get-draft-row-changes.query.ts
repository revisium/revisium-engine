import type { RowColumn } from 'src/features/partial-changes/catalogue/unit';
import type {
  DraftEdge,
  DraftPageInfo,
  DraftReadState,
  FieldSelection,
  FollowReason,
  GoesWithSelection,
  IdExchangeTermination,
  RefusedSelection,
} from 'src/features/partial-changes/queries/impl/draft-reads';
import type { SelectionItems } from 'src/features/partial-changes/selection/selection';
import type { UnitRef } from 'src/features/partial-changes/selection/unit-refs';
import type { ChangesBranch } from 'src/features/partial-changes/snapshot/changes-snapshot';
import {
  ChangeType,
  RowChangeDetailType,
} from 'src/features/revision-changes/types';

// What the row filter and the row counts tell apart: the change types, and REPLACED for the two items of a replaced row.
export const DRAFT_ROW_CHANGE_KINDS = [
  ...Object.values(ChangeType),
  'REPLACED',
] as const;

export type DraftRowChangeKind = (typeof DRAFT_ROW_CHANGE_KINDS)[number];

export interface DraftRowChangesFilters {
  readonly tableId?: string | null;
  readonly rowIds?: readonly string[] | null;
  readonly changeTypes?: readonly DraftRowChangeKind[] | null;
  readonly search?: string | null;
}

// The orders of the row read: by row id, or by the time of each row's last change in the Draft, newest first.
export const DRAFT_ROW_ORDERS = ['id', 'recent'] as const;

export type DraftRowOrder = (typeof DRAFT_ROW_ORDERS)[number];

export interface DraftRowChangesInput {
  readonly branch: ChangesBranch;
  readonly first: number;
  readonly after?: string | null;
  readonly filters?: DraftRowChangesFilters | null;
  readonly fieldsPerRow?: number | null;
  readonly orderBy?: DraftRowOrder | null;
  readonly maxValueBytes?: number | null;
}

export interface SelectableRowSelection {
  readonly state: 'selectable';
  readonly row: SelectionItems;
  readonly structure?: UnitRef;
}

// Every row selection lists the row's own units, empty unless it is selectable.
export type RowSelection = { readonly units: readonly UnitRef[] } & (
  | RefusedSelection
  | GoesWithSelection
  | SelectableRowSelection
);

// The values of the native RowChangeDetailType that the row value diff produces.
export const DRAFT_FIELD_CHANGE_TYPES = [
  RowChangeDetailType.FieldAdded,
  RowChangeDetailType.FieldRemoved,
  RowChangeDetailType.FieldModified,
] as const;

export type DraftFieldChangeType = (typeof DRAFT_FIELD_CHANGE_TYPES)[number];

// How a side over the byte limit is returned: a string as its longest prefix within the limit; any other value omitted
// (null), since a part of it is no JSON value.
export const DRAFT_VALUE_CUTS = ['prefix', 'omitted'] as const;

export type DraftValueCut = (typeof DRAFT_VALUE_CUTS)[number];

// The rename whose cascade rewrote a reference.
export interface FollowedUnit {
  readonly unit: UnitRef;
  readonly reason: FollowReason;
}

export interface DraftFieldChange {
  readonly path: string;
  readonly changeType: DraftFieldChangeType;
  readonly oldValue: unknown;
  readonly newValue: unknown;
  // With maxValueBytes: the bytes of each whole side's JSON text, null for a side without the value, and the cut sides.
  readonly oldValueBytes?: number | null;
  readonly newValueBytes?: number | null;
  // With maxValueBytes: the token of each whole side, as changes.fieldValue returns it; null for a side without the value.
  readonly oldValueToken?: string | null;
  readonly newValueToken?: string | null;
  readonly oldValueCut?: DraftValueCut;
  readonly newValueCut?: DraftValueCut;
  readonly selection: FieldSelection;
  readonly follows?: FollowedUnit;
}

// An array at or around a listed field change: its number of elements on each side, null where that side has none.
export interface DraftArrayLengths {
  readonly path: string;
  readonly oldLength: number | null;
  readonly newLength: number | null;
}

// A rename into the id of a deleted row: both items carry the deletion and the rename.
export interface IdTakeover {
  readonly deletion: UnitRef;
  readonly rename: UnitRef;
}

// The renames of a chain, the item's own first, each taking the Head id of the next.
export interface IdExchange {
  readonly renames: readonly UnitRef[];
  readonly termination: IdExchangeTermination;
}

export interface DraftColumnChange {
  readonly column: RowColumn;
  readonly oldValue: unknown;
  readonly newValue: unknown;
  readonly selection: FieldSelection;
}

export interface DraftRowItem {
  readonly tableId: string;
  readonly previousTableId?: string;
  readonly rowId: string;
  readonly previousRowId?: string;
  readonly changeType: ChangeType;
  readonly replaced: boolean;
  readonly changedAt: Date | null;
  readonly fields: readonly DraftFieldChange[];
  readonly fieldsTotal: number;
  readonly arrays: readonly DraftArrayLengths[];
  readonly columns: readonly DraftColumnChange[];
  readonly selection: RowSelection;
  readonly idTakeover?: IdTakeover;
  readonly idExchange?: IdExchange;
}

export interface DraftRowPage extends DraftReadState {
  readonly edges: readonly DraftEdge<DraftRowItem>[];
  readonly pageInfo: DraftPageInfo;
}

export class GetDraftRowChangesQuery {
  constructor(public readonly data: DraftRowChangesInput) {}
}
