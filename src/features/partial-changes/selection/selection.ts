import type { HeadQualifier } from 'src/features/partial-changes/catalogue/unit';

export type TableRef =
  | string
  | { readonly tableId: string; readonly side?: HeadQualifier };

export interface RowRef {
  readonly tableId: string;
  readonly rowId: string;
  readonly side?: HeadQualifier;
}

export interface FieldRef {
  readonly tableId: string;
  readonly rowId: string;
  readonly path: string;
}

export interface SelectionItems {
  readonly tables?: readonly TableRef[];
  readonly tableData?: readonly string[];
  readonly views?: readonly string[];
  readonly sharedSchemas?: readonly string[];
  readonly rows?: readonly RowRef[];
  readonly renames?: readonly RowRef[];
  readonly rowColumns?: readonly RowRef[];
  readonly fields?: readonly FieldRef[];
}

export interface Selection extends SelectionItems {
  readonly all?: boolean;
  readonly exclude?: SelectionItems;
}

export type ItemKind = keyof SelectionItems;

export type ItemSelector<K extends ItemKind> = NonNullable<
  SelectionItems[K]
>[number];

const WHOLE_DRAFT_KEY = 'all';

export function tableRefOf(selector: TableRef): Exclude<TableRef, string> {
  if (typeof selector === 'string') {
    return { tableId: selector };
  }

  return selector;
}

export function isWholeDraftSelection(selection: Selection): boolean {
  return (
    selection.all === true &&
    Object.keys(selection).every((key) => key === WHOLE_DRAFT_KEY)
  );
}
