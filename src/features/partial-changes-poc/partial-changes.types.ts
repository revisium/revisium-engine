export type ChangesBranch = { projectId: string; branchName: string };

export type ChangeOperation = 'commit' | 'revert';

export type RowSelector = { tableId: string; rowId: string; side?: 'head' };

export type FieldSelector = { tableId: string; rowId: string; path: string };

export interface SelectionItems {
  tables?: string[];
  tableData?: string[];
  views?: string[];
  sharedSchemas?: string[];
  rows?: RowSelector[];
  fields?: FieldSelector[];
}

export interface Selection extends SelectionItems {
  all?: boolean;
  exclude?: SelectionItems;
}

export type UnitKind =
  | 'rowCreate'
  | 'rowDelete'
  | 'rowReplace'
  | 'rowRename'
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
  | 'migrationInProgress';

export interface Blocker {
  code: BlockerCode;
  tableId?: string;
  rowId?: string;
  path?: string;
  message: string;
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
  sample: PublicUnit[];
  unmatched: SelectionItems;
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
  remaining?: { units: number };
  required?: RequiredUnit[];
  blockers?: Blocker[];
}
