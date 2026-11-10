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

export const SELECTOR_SIDES = ['head'] as const;

export type SelectorSide = (typeof SELECTOR_SIDES)[number];

export type Unit =
  | {
      readonly kind: 'field';
      readonly tableId: string;
      readonly rowId: string;
      readonly path: string;
    }
  | {
      readonly kind: 'rowCreate' | 'rowDelete' | 'rowReplace';
      readonly tableId: string;
      readonly rowId: string;
    }
  | {
      readonly kind: 'rowRename';
      readonly tableId: string;
      readonly rowId: string;
      readonly previousRowId: string;
    }
  | {
      readonly kind: 'rowColumns';
      readonly tableId: string;
      readonly rowId: string;
      readonly columns: readonly RowColumn[];
    }
  | {
      readonly kind: 'structure';
      readonly tableId: string;
      readonly previousTableId?: string;
    }
  | { readonly kind: 'views'; readonly tableId: string }
  | { readonly kind: 'sharedSchema'; readonly sharedSchemaId: string };

export interface UnitAddress {
  readonly kind: UnitKind;
  readonly tableId: string;
  readonly previousTableId?: string;
  readonly rowId?: string;
  readonly previousRowId?: string;
  readonly path?: string;
  readonly columns?: readonly RowColumn[];
}
