export const UNIT_KINDS = [
  'field',
  'rowCreate',
  'rowDelete',
  'rowReplace',
  'rowRename',
  'rowColumns',
  'structure',
  'views',
  'sharedSchema',
] as const;

export type UnitKind = (typeof UNIT_KINDS)[number];

export const ROW_COLUMNS = ['publishedAt', 'meta', 'schemaHash'] as const;

export type RowColumn = (typeof ROW_COLUMNS)[number];

export const HEAD_QUALIFIERS = ['head'] as const;

export type HeadQualifier = (typeof HEAD_QUALIFIERS)[number];

export interface Unit {
  readonly kind: UnitKind;
  readonly tableId: string;
  readonly previousTableId?: string;
  readonly rowId?: string;
  readonly previousRowId?: string;
  readonly path?: string;
  readonly columns?: readonly RowColumn[];
}
