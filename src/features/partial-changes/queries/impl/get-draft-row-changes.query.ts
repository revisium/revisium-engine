import type { RowColumn } from 'src/features/partial-changes/catalogue/unit';
import type {
  ComputedSelection,
  DraftEdge,
  DraftPageInfo,
  DraftReadState,
  DraftTableChangesFilters,
  FieldSelection,
  FollowReason,
  GoesWithSelection,
  IdExchangeTermination,
  RefusedSelection,
} from 'src/features/partial-changes/queries/impl/draft-reads';
import type { SelectionItems } from 'src/features/partial-changes/selection/selection';
import type { UnitRef } from 'src/features/partial-changes/selection/unit-refs';
import type { ChangesBranch } from 'src/features/partial-changes/snapshot/changes-snapshot';
import type {
  ChangeType,
  RowChangeDetailType,
} from 'src/features/revision-changes/types';

export interface DraftRowChangesFilters extends DraftTableChangesFilters {
  readonly tableId?: string | null;
}

export interface DraftRowChangesInput {
  readonly branch: ChangesBranch;
  readonly first: number;
  readonly after?: string | null;
  readonly filters?: DraftRowChangesFilters | null;
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
  | ComputedSelection
  | SelectableRowSelection
);

// The values of the native RowChangeDetailType that the row value diff produces.
export type DraftFieldChangeType = Exclude<
  RowChangeDetailType,
  RowChangeDetailType.FieldMoved
>;

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
  readonly selection: FieldSelection;
  readonly follows?: FollowedUnit;
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
  readonly fields: readonly DraftFieldChange[];
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
