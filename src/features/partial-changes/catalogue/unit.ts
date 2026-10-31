export type UnitKind =
  | 'field'
  | 'rowCreate'
  | 'rowDelete'
  | 'rowReplace'
  | 'rowRename'
  | 'rowColumns'
  | 'structure'
  | 'views'
  | 'sharedSchema';

export type RowColumn = 'publishedAt' | 'meta' | 'schemaHash';

export type Side = 'head';

export interface Unit {
  readonly kind: UnitKind;
  readonly tableId: string;
  readonly previousTableId?: string;
  readonly rowId?: string;
  readonly previousRowId?: string;
  readonly path?: string;
  readonly columns?: readonly RowColumn[];
}
