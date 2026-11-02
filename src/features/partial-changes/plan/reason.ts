export type RequiredReasonCode =
  | 'structureBoundData'
  | 'wholeRowUnit'
  | 'atomicValue'
  | 'referencedRowMissing'
  | 'referrerStillReferences'
  | 'idOccupied'
  | 'referencedTableMissing'
  | 'viewsDoNotFitStructure';

export interface Reason {
  readonly code: RequiredReasonCode;
  readonly tableId: string;
  readonly rowId?: string;
  readonly path?: string;
  readonly because: string;
}
