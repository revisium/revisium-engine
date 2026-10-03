export interface DraftChangesConsumerBranch {
  projectId: string;
  branchName: string;
}

export interface DraftChangesConsumerCounts {
  tables: number;
  rows: number;
  fields: number;
}

export interface DraftChangesPage {
  first?: number;
  after?: string;
}

export interface DraftChangesConnection<T> {
  totalCount: number;
  edges: Array<{ cursor: string; node: T }>;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

export interface DraftChangedTableItem {
  tableId: string;
  previousTableId: string | null;
  changes: string[];
  schemaFieldCount: number;
  changedRowCount: number;
  refs: DraftChangeLeaf[];
}

export interface DraftChangedRowItem {
  tableId: string;
  rowId: string;
  previousRowId: string | null;
  changes: string[];
  changedFieldCount: number;
  hasMoreChanges: boolean;
  refs: DraftChangeLeaf[];
}

export type DraftChangesChoice =
  | { kind: 'all' }
  | { kind: 'table'; tableId: string; rows?: 'all' | 'none' }
  | { kind: 'rows'; tableId: string; rowIds?: 'all' | string[] }
  | {
      kind: 'rowFields';
      tableId: string;
      rowId: string;
      paths?: 'all' | string[];
    }
  | { kind: 'schemaFields'; tableId: string; paths?: 'all' | string[] }
  | { kind: 'change'; ref: DraftChangeRef };

export interface DraftChangesSelection {
  include: DraftChangesChoice[];
  exclude?: DraftChangesChoice[];
}

export interface DraftChangeRef {
  readonly value: string;
}

export interface DraftChangeLeaf {
  ref: DraftChangeRef;
  kind: 'created' | 'deleted' | 'renamed' | 'updated' | 'computed' | 'atomic';
  label: string;
  selectable: boolean;
  effect?: DraftChangesPlanEffect;
}

export interface DraftRowChanges {
  tableId: string;
  rowId: string;
  changes: DraftChangeLeaf[];
  totalCount: number;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

export interface DraftTableChanges {
  tableId: string;
  schemaChanges: DraftChangeLeaf[];
  viewsChanges?: DraftChangeLeaf[];
  rowCount: number;
}

export interface DraftChangesSnapshot {
  isEmpty: boolean;
  counts: DraftChangesConsumerCounts;
}

export type DraftChangesOperation = 'commit' | 'discard';

export type DraftChangesPlanStatus =
  | 'ready'
  | 'confirmationRequired'
  | 'blocked'
  | 'empty';

export interface DraftChangesPlan {
  status: DraftChangesPlanStatus;
  planToken: string;
  selected: DraftChangesConsumerCounts;
  automatic: DraftChangesConsumerCounts;
  required: DraftChangesConsumerCounts;
  remaining: DraftChangesConsumerCounts;
  automaticChanges: DraftChangesEffectGroup[];
  requiredGroups: DraftChangesEffectGroup[];
  requiredAcknowledgmentToken?: string;
  blockers: string[];
}

export interface DraftChangesEffectGroup {
  ref: DraftChangeRef;
  kind: string;
  count: number;
  counts?: DraftChangesConsumerCounts;
  summary: string;
}

export interface DraftChangesPlanEffect {
  target?: 'head' | 'draft';
  tableId: string;
  rowId?: string;
  path?: string;
  change: string;
  before: unknown;
  after: unknown;
  beforeExists?: boolean;
  afterExists?: boolean;
}

export interface DraftChangesPlanDetails {
  group: DraftChangesEffectGroup;
  effects: DraftChangesConnection<DraftChangesPlanEffect>;
}

export interface DraftChangesPlanRequest {
  branch: DraftChangesConsumerBranch;
  operation: DraftChangesOperation;
  selection: DraftChangesSelection;
}

export interface DraftChangesExecuteRequest {
  branch: DraftChangesConsumerBranch;
  planToken: string;
  requestId: string;
  requiredAcknowledgmentToken?: string;
  message?: string;
}

export interface DraftChangesExecutionResult {
  status: 'applied' | 'stalePlan' | 'blocked' | 'replayed';
  receiptId?: string;
  message?: string;
  previousHeadRevisionId?: string;
  headRevisionId?: string;
  draftRevisionId?: string;
  result?: unknown;
  applied?: {
    selected: DraftChangesConsumerCounts;
    automatic: DraftChangesConsumerCounts;
    required: DraftChangesConsumerCounts;
    total: DraftChangesConsumerCounts;
  };
  remaining?: DraftChangesSnapshot;
}

export interface ChangesApi {
  draftChanges(
    branch: DraftChangesConsumerBranch,
  ): Promise<DraftChangesSnapshot>;
  draftChangedTables(
    branch: DraftChangesConsumerBranch,
    page?: DraftChangesPage,
  ): Promise<DraftChangesConnection<DraftChangedTableItem>>;
  draftChangedRows(
    branch: DraftChangesConsumerBranch,
    tableId: string,
    page?: DraftChangesPage,
  ): Promise<DraftChangesConnection<DraftChangedRowItem>>;
  draftTableChanges(
    branch: DraftChangesConsumerBranch,
    tableId: string,
  ): Promise<DraftTableChanges>;
  draftRowChanges(
    branch: DraftChangesConsumerBranch,
    tableId: string,
    rowId: string,
    page?: DraftChangesPage,
  ): Promise<DraftRowChanges>;
  planDraftChanges(request: DraftChangesPlanRequest): Promise<DraftChangesPlan>;
  draftChangesPlanDetails(
    branch: DraftChangesConsumerBranch,
    planToken: string,
    groupRef: DraftChangeRef,
    page?: DraftChangesPage,
  ): Promise<DraftChangesPlanDetails>;
  executeDraftChanges(
    request: DraftChangesExecuteRequest,
  ): Promise<DraftChangesExecutionResult>;
}
