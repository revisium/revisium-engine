import type {
  DraftEdge,
  DraftPageInfo,
  DraftReadState,
  DraftTableChangesFilters,
  RefusedSelection,
} from 'src/features/partial-changes/queries/impl/draft-reads';
import type { SelectionItems } from 'src/features/partial-changes/selection/selection';
import type {
  DescribedUnitRef,
  UnitRef,
} from 'src/features/partial-changes/selection/unit-refs';
import type { ChangesBranch } from 'src/features/partial-changes/snapshot/changes-snapshot';
import type {
  ChangeType,
  RevisionChangeSummary,
  SchemaMigrationDetail,
  ViewsChangeDetail,
} from 'src/features/revision-changes/types';

export interface DraftTableChangesInput {
  readonly branch: ChangesBranch;
  readonly first: number;
  readonly after?: string | null;
  readonly filters?: DraftTableChangesFilters | null;
}

export const TABLE_SELECTION_STATES = [
  'refused',
  'contentEqual',
  'selectable',
] as const;

export type TableSelectionState = (typeof TABLE_SELECTION_STATES)[number];

export interface ContentEqualSelection {
  readonly state: 'contentEqual';
}

export interface TableData {
  readonly selector: SelectionItems;
  readonly rows: number;
}

export interface SelectableTableSelection {
  readonly state: 'selectable';
  readonly structure?: DescribedUnitRef;
  readonly views?: UnitRef;
  readonly tableData?: TableData;
}

export type TableSelection =
  | RefusedSelection
  | ContentEqualSelection
  | SelectableTableSelection;

export interface DraftTableItem {
  readonly tableId: string;
  readonly previousTableId?: string;
  readonly changeType: ChangeType;
  readonly replaced: boolean;
  readonly rowsSummary: RevisionChangeSummary;
  readonly schemaMigrations: readonly SchemaMigrationDetail[];
  readonly viewsChanges: ViewsChangeDetail;
  readonly selection: TableSelection;
}

export interface DraftTablePage extends DraftReadState {
  readonly edges: readonly DraftEdge<DraftTableItem>[];
  readonly pageInfo: DraftPageInfo;
  readonly totalCount: number;
}

export class GetDraftTableChangesQuery {
  constructor(public readonly data: DraftTableChangesInput) {}
}
