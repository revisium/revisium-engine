import type { RowColumn } from 'src/features/partial-changes/catalogue/unit';
import type {
  ComputedSelection,
  DraftEdge,
  DraftPageInfo,
  DraftReadState,
  FieldSelection,
  GoesWithSelection,
  RefusedSelection,
} from 'src/features/partial-changes/queries/impl/draft-reads';
import type { SelectionItems } from 'src/features/partial-changes/selection/selection';
import type { UnitRef } from 'src/features/partial-changes/selection/unit-refs';
import type { ChangesBranch } from 'src/features/partial-changes/snapshot/changes-snapshot';
import type {
  ChangeType,
  RowChangeDetailType,
} from 'src/features/revision-changes/types';

export interface DraftRowChangesInput {
  readonly branch: ChangesBranch;
  readonly first: number;
  readonly after?: string | null;
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

export interface DraftFieldChange {
  readonly path: string;
  readonly changeType: DraftFieldChangeType;
  readonly oldValue: unknown;
  readonly newValue: unknown;
  readonly selection: FieldSelection;
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
}

export interface DraftRowPage extends DraftReadState {
  readonly edges: readonly DraftEdge<DraftRowItem>[];
  readonly pageInfo: DraftPageInfo;
}

export class GetDraftRowChangesQuery {
  constructor(public readonly data: DraftRowChangesInput) {}
}
