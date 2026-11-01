import type { Side } from 'src/features/partial-changes/catalogue/unit';

export type TableRef =
  | string
  | { readonly tableId: string; readonly side?: Side };

export interface RowRef {
  readonly tableId: string;
  readonly rowId: string;
  readonly side?: Side;
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

const ITEM_KINDS: readonly ItemKind[] = [
  'tables',
  'tableData',
  'views',
  'sharedSchemas',
  'rows',
  'renames',
  'rowColumns',
  'fields',
];

export function isWholeDraftSelection(selection: Selection): boolean {
  return (
    selection.all === true &&
    !hasSelectors(selection) &&
    !hasSelectors(selection.exclude ?? {})
  );
}

function hasSelectors(items: SelectionItems): boolean {
  return ITEM_KINDS.some((kind) => (items[kind]?.length ?? 0) > 0);
}
