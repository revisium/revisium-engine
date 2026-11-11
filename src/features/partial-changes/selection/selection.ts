import type { SelectorSide } from 'src/features/partial-changes/catalogue/unit';

export interface TableRef {
  readonly tableId: string;
  readonly side?: SelectorSide;
}

export interface RowRef {
  readonly tableId: string;
  readonly rowId: string;
  readonly side?: SelectorSide;
}

export interface FieldRef {
  readonly tableId: string;
  readonly rowId: string;
  readonly path: string;
}

export interface SelectionItems {
  readonly structures?: readonly TableRef[];
  readonly tableData?: readonly string[];
  readonly views?: readonly string[];
  readonly sharedSchemas?: readonly string[];
  readonly rows?: readonly RowRef[];
  readonly rowRenames?: readonly RowRef[];
  readonly rowColumns?: readonly RowRef[];
  readonly fields?: readonly FieldRef[];
}

export interface Selection extends SelectionItems {
  readonly all?: boolean;
  readonly exclude?: SelectionItems;
}

export type SelectionInput = NullableOptionals<Selection>;

type NullableOptionals<T> = T extends readonly (infer Item)[]
  ? readonly NullableOptionals<Item>[]
  : T extends object
    ? {
        readonly [K in keyof T]: undefined extends T[K]
          ? NullableOptionals<T[K]> | null
          : NullableOptionals<T[K]>;
      }
    : T;

export type ItemKind = keyof SelectionItems;

export type ItemSelector<K extends ItemKind> = NonNullable<
  SelectionItems[K]
>[number];

const WHOLE_DRAFT_KEY = 'all';

export function selectsWholeDraft(selection: Selection): boolean {
  return (
    selection.all === true &&
    Object.keys(selection).every((key) => key === WHOLE_DRAFT_KEY)
  );
}
