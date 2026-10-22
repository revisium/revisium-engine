export type ChangesBranch = { projectId: string; branchName: string };

export type ChangeOperation = 'commit' | 'revert';

export type RowSelector = { tableId: string; rowId: string; side?: 'head' };

export type TableSelector = string | { tableId: string; side?: 'head' };

export type FieldSelector = { tableId: string; rowId: string; path: string };

export interface SelectionItems {
  tables?: TableSelector[];
  tableData?: string[];
  views?: string[];
  sharedSchemas?: string[];
  rows?: RowSelector[];
  renames?: RowSelector[];
  rowColumns?: RowSelector[];
  fields?: FieldSelector[];
}

export interface Selection extends SelectionItems {
  all?: boolean;
  exclude?: SelectionItems;
}

export interface UnmatchedSelection extends SelectionItems {
  exclude?: SelectionItems;
}

export type UnitKind =
  | 'rowCreate'
  | 'rowDelete'
  | 'rowReplace'
  | 'rowRename'
  | 'rowColumns'
  | 'field'
  | 'structure'
  | 'views'
  | 'sharedSchema';

export interface PublicUnit {
  kind: UnitKind;
  tableId: string;
  previousTableId?: string;
  rowId?: string;
  previousRowId?: string;
  path?: string;
  columns?: string[];
}

export type RequiredReasonCode =
  | 'referencedRowMissing'
  | 'referrerStillReferences'
  | 'idOccupied'
  | 'wholeRowUnit'
  | 'atomicValue'
  | 'structureBoundData'
  | 'referencedTableMissing'
  | 'viewsDoNotFitStructure';

export interface RequiredReason {
  code: RequiredReasonCode;
  tableId: string;
  rowId?: string;
  path?: string;
  because: string;
}

export interface RequiredUnit {
  unit: PublicUnit;
  reason: RequiredReason;
}

export type BlockerCode =
  | 'requiredExcluded'
  | 'notSelectable'
  | 'danglingInSource'
  | 'invalidRow'
  | 'invalidViews'
  | 'ledgerInconsistent'
  | 'unrecordedStructureChange'
  | 'migrationInProgress'
  | 'unmatchedSelector'
  | 'tooLarge';

export interface Blocker {
  code: BlockerCode;
  tableId?: string;
  rowId?: string;
  path?: string;
  message: string;
}

export interface DeferredValues {
  unit: PublicUnit;
  paths: string[];
  structure: PublicUnit;
}

export interface RenumberedMigrationId {
  from: string;
  to: string;
}

export interface MixedTableEstimate {
  tableId: string;
  linksCopied: number;
  linksAdded: number;
}

export interface OperationEstimate {
  changedRows: number;
  mergedRows: number;
  perRowWorkRows: number;
  mixedTables: MixedTableEstimate[];
}

export interface UnitCounts {
  selected: number;
  required: number;
  remaining: number;
}

export type PreviewStatus = 'ready' | 'required' | 'blocked' | 'empty';

export interface PreviewChangesInput {
  branch: ChangesBranch;
  operation: ChangeOperation;
  selection: Selection;
  includeRequired?: boolean;
}

export interface PreviewChangesResult {
  status: PreviewStatus;
  fingerprint: string;
  counts: UnitCounts;
  required: RequiredUnit[];
  blockers: Blocker[];
  deferred: DeferredValues[];
  sample: PublicUnit[];
  unmatched: UnmatchedSelection;
  estimate: OperationEstimate;
  unreadTables: number;
}

export interface ListChangesInput {
  branch: ChangesBranch;
  cursor?: string;
  limit?: number;
  tableId?: string;
}

export interface ListedUnit extends PublicUnit {
  side?: 'head';
  structure?: PublicUnit;
  selector?: Selection;
}

export interface ListChangesResult {
  headRevisionId: string;
  draftRevisionId: string;
  units: ListedUnit[];
  nextCursor?: string;
}

export type ApplyStatus =
  | 'applied'
  | 'required'
  | 'blocked'
  | 'stale'
  | 'empty';

export interface CommitChangesInput {
  branch: ChangesBranch;
  selection: Selection;
  includeRequired?: boolean;
  expected?: string;
  comment?: string;
}

export interface RevertChangesInput {
  branch: ChangesBranch;
  selection: Selection;
  includeRequired?: boolean;
  expected?: string;
}

export interface ApplyChangesResult {
  status: ApplyStatus;
  previousHeadRevisionId?: string;
  headRevisionId?: string;
  draftRevisionId?: string;
  applied?: { selected: number; required: number };
  remaining?: { units: number; unreadTables: number };
  renumbered?: RenumberedMigrationId[];
  required?: RequiredUnit[];
  blockers?: Blocker[];
  unmatched?: UnmatchedSelection;
}
