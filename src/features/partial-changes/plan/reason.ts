export const REQUIRED_REASON_CODES = [
  'structureBoundData',
  'wholeRowUnit',
  'atomicValue',
  'referencedRowMissing',
  'referrerStillReferences',
  'idOccupied',
  'referencedTableMissing',
] as const;

export type RequiredReasonCode = (typeof REQUIRED_REASON_CODES)[number];

export interface Reason {
  readonly code: RequiredReasonCode;
  readonly tableId: string;
  readonly rowId?: string;
  readonly path?: string;
  readonly because: string;
}
