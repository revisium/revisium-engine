import { deepEqual } from '@revisium/schema-toolkit/lib';
import type { Row } from 'src/engine-prisma-types';
import type { AddressedRow } from 'src/features/partial-changes/catalogue/catalogue-lookup';
import {
  type CatalogueRow,
  type CatalogueUnit,
  isExistenceUnit,
} from 'src/features/partial-changes/catalogue/catalogue-unit';
import { differingColumnsOf } from 'src/features/partial-changes/catalogue/row-differences';
import type { RowColumn } from 'src/features/partial-changes/catalogue/unit';
import { compareUnits } from 'src/features/partial-changes/catalogue/unit-order';
import type { DraftCatalogue } from 'src/features/partial-changes/draft-reads/draft-catalogue';
import type { RowRename } from 'src/features/partial-changes/draft-reads/id-exchanges';
import type {
  PageRenames,
  RenamedRow,
} from 'src/features/partial-changes/draft-reads/page-renames';
import { tableIdsOf } from 'src/features/partial-changes/draft-reads/table-ids';
import { cutValueOf } from 'src/features/partial-changes/draft-reads/json-values';
import { pointerOfNativeFieldPath } from 'src/features/partial-changes/draft-reads/native-field-path';
import type { ReportedRowPair } from 'src/features/partial-changes/draft-reads/reported-rows-sql';
import type { RefusedTable } from 'src/features/partial-changes/head-schema/head-schema-check';
import type {
  FieldSelection,
  GoesWithReason,
  GoesWithSelection,
  RefusedSelection,
} from 'src/features/partial-changes/queries/impl/draft-reads';
import type {
  DraftArrayLengths,
  DraftColumnChange,
  DraftFieldChange,
  DraftFieldChangeType,
  DraftRowItem,
  DraftValueCut,
  FollowedUnit,
  IdExchange,
  IdTakeover,
  RowSelection,
} from 'src/features/partial-changes/queries/impl/get-draft-row-changes.query';
import { isCreatedOrRemoved } from 'src/features/partial-changes/selection/created-or-removed-tables';
import type { SelectorMatch } from 'src/features/partial-changes/selection/selector-match';
import {
  type UnitRef,
  unitRefOf,
} from 'src/features/partial-changes/selection/unit-refs';
import {
  publicTableIdOf,
  type TablePair,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';
import {
  type FieldChange,
  RowChangeDetailType,
} from 'src/features/revision-changes/types';

// The Head and the Draft data of a row after the formula values of the page's rows are computed; null for no version.
export interface ComputedData {
  readonly head: unknown;
  readonly draft: unknown;
}

// A reported row of a page: its pair, its stored versions and the native field changes of its computed values.
export interface DraftRowEntry {
  readonly table: TablePair;
  readonly pair: ReportedRowPair;
  readonly head?: Row;
  readonly draft?: Row;
  readonly fieldChanges: readonly FieldChange[];
  readonly computed: ComputedData;
}

// The field limit and the value limit of an item.
export interface FieldListing {
  readonly fieldsPerRow?: number;
  readonly maxValueBytes?: number;
}

interface FieldValues {
  oldValue: unknown;
  newValue: unknown;
  oldValueBytes?: number | null;
  newValueBytes?: number | null;
  oldValueToken?: string | null;
  newValueToken?: string | null;
  oldValueCut?: DraftValueCut;
  newValueCut?: DraftValueCut;
}

interface SideValue {
  readonly value: unknown;
  readonly bytes: number | null;
  readonly token: string | null;
  readonly cut?: DraftValueCut;
}

type RowIds = Pick<DraftRowItem, 'rowId' | 'previousRowId'>;
type ItemIds = Pick<DraftRowItem, 'tableId' | 'previousTableId'> & RowIds;
type ItemHeading = ItemIds &
  Pick<
    DraftRowItem,
    'changeType' | 'replaced' | 'changedAt' | 'fieldsTotal' | 'arrays'
  >;

const COMPUTED = { state: 'computed' } as const;
const NO_VALUE: SideValue = { value: null, bytes: null, token: null };

// With a field limit, the item lists the first field changes of the row only, and fieldsTotal counts all of them; with
// a value limit, each side of a listed change says its size and is cut over the limit.
export function draftRowItemOf(
  entry: DraftRowEntry,
  catalogue: DraftCatalogue,
  renames: PageRenames,
  listing: FieldListing,
): DraftRowItem {
  return new DraftRow(entry, catalogue, renames, listing).item();
}

class DraftRow {
  private readonly row: AddressedRow;

  constructor(
    private readonly entry: DraftRowEntry,
    private readonly catalogue: DraftCatalogue,
    private readonly renames: PageRenames,
    private readonly listing: FieldListing,
  ) {
    this.row = addressedRowOf(entry);
  }

  public item(): DraftRowItem {
    const refusal = this.catalogue.refusalOf(this.entry.table);

    if (refusal) {
      return this.refusedItem(refusal);
    }

    return this.withIdExchange(
      this.withIdTakeover({
        ...this.heading(),
        fields: this.fields((pointer) => this.fieldSelectionAt(pointer)),
        columns: this.columns((column) => this.columnSelectionOf(column)),
        selection: this.selection(),
      }),
    );
  }

  private refusedItem({ code }: RefusedTable): DraftRowItem {
    const refused: RefusedSelection = { state: 'refused', code };

    return {
      ...this.heading(),
      fields: this.fields(() => refused),
      columns: this.columns(() => refused),
      selection: withoutOwnUnits(refused),
    };
  }

  private withIdTakeover(item: DraftRowItem): DraftRowItem {
    const idTakeover = this.idTakeover();

    if (!idTakeover) {
      return item;
    }

    return { ...item, idTakeover };
  }

  private withIdExchange(item: DraftRowItem): DraftRowItem {
    const idExchange = this.idExchange();

    if (!idExchange) {
      return item;
    }

    return { ...item, idExchange };
  }

  // A rename into the id of a deleted row: the two items share the row id, so both find the deletion and the rename.
  private idTakeover(): IdTakeover | undefined {
    const { table } = this.entry;
    const { rowId } = this.row;
    const deletion = this.catalogue.unitOfRowOn(
      { table, rowId, side: 'head' },
      'rowDelete',
    );
    const rename = this.catalogue.unitOfRowOn(
      { table, rowId, side: 'draft' },
      'rowRename',
    );

    if (!deletion || !rename) {
      return undefined;
    }

    return { deletion: unitRefOf(deletion), rename: unitRefOf(rename) };
  }

  private idExchange(): IdExchange | undefined {
    const chain = this.renames.chainOf(
      this.entry.table.identity,
      this.entry.pair.identity,
    );

    if (!chain) {
      return undefined;
    }

    return {
      renames: chain.renames.map((rename) => this.exchangedRenameOf(rename)),
      termination: chain.termination,
    };
  }

  private exchangedRenameOf({ draftRowId }: RowRename): UnitRef {
    const rename = this.renameUnitOf({
      tableIdentity: this.entry.table.identity,
      rowId: draftRowId,
    });

    if (!rename) {
      throw new Error(
        `${this.address()} exchanges ids with ${draftRowId}, which has no rename unit`,
      );
    }

    return rename;
  }

  private followedRenameAt(pointer: JsonPointer): FollowedUnit | undefined {
    const renamed = this.renames.followedAt({
      tableIdentity: this.entry.table.identity,
      rowIdentity: this.entry.pair.identity,
      pointer: pointer.toString(),
    });
    const rename = renamed && this.renameUnitOf(renamed);

    if (!rename) {
      return undefined;
    }

    return { unit: rename, reason: 'referenceRename' };
  }

  private renameUnitOf({
    tableIdentity,
    rowId,
  }: RenamedRow): UnitRef | undefined {
    const rename = this.catalogue.unitOfRowOn(
      { table: this.catalogue.tableOf(tableIdentity), rowId, side: 'draft' },
      'rowRename',
    );

    return rename && unitRefOf(rename);
  }

  private heading(): ItemHeading {
    const { pair, fieldChanges } = this.entry;

    return {
      ...tableIdsOf(this.entry.table),
      ...rowIdsOf(this.entry),
      changeType: pair.changeType,
      replaced: pair.replaced,
      changedAt: timeOf(pair.changedAt),
      fieldsTotal: fieldChanges.length,
      arrays: this.arrays(),
    };
  }

  // The arrays at and around the listed field changes, each once, outer first: a client folds the unchanged elements
  // of an array between its listed changes without reading it.
  private arrays(): DraftArrayLengths[] {
    const { head, draft } = this.entry.computed;
    const arrays = new Map<string, DraftArrayLengths>();

    for (const { fieldPath } of this.listedFieldChanges()) {
      for (const pointer of pointersAlong(
        pointerOfNativeFieldPath(fieldPath),
      )) {
        const path = pointer.toString();
        const oldLength = arrayLengthOf(pointer.valueIn(head));
        const newLength = arrayLengthOf(pointer.valueIn(draft));

        if (!arrays.has(path) && (oldLength !== null || newLength !== null)) {
          arrays.set(path, { path, oldLength, newLength });
        }
      }
    }

    return [...arrays.values()];
  }

  private selection(): RowSelection {
    if (isCreatedOrRemoved(this.entry.table)) {
      return withoutOwnUnits(this.goesWithStructure('tableExistence'));
    }

    const units = this.catalogue.unitsOfRow(this.row).sort(compareUnits);

    if (units.length > 0) {
      return this.selectableRow(units);
    }

    return withoutOwnUnits(this.goesWithStructure('structureBound'));
  }

  private selectableRow(units: readonly CatalogueUnit[]): RowSelection {
    const side = units.find((unit) => unit.side !== undefined)?.side;
    const row = {
      tableId: publicTableIdOf(this.entry.table),
      rowId: this.row.rowId,
    };
    const selection = {
      state: 'selectable' as const,
      row: { rows: [side === undefined ? row : { ...row, side }] },
      units: units.map(unitRefOf),
    };
    const structure = this.catalogue.structureOf(this.entry.table);

    if (!structure) {
      return selection;
    }

    return { ...selection, structure: unitRefOf(structure) };
  }

  private fields(
    selectionAt: (pointer: JsonPointer) => FieldSelection,
  ): DraftFieldChange[] {
    return this.listedFieldChanges().map(
      ({ fieldPath, changeType, oldValue, newValue }) => {
        const pointer = pointerOfNativeFieldPath(fieldPath);
        const fieldChangeType = draftFieldChangeTypeOf(changeType);
        const change: DraftFieldChange = {
          path: pointer.toString(),
          changeType: fieldChangeType,
          ...this.valuesOf(fieldChangeType, oldValue ?? null, newValue ?? null),
          selection: selectionAt(pointer),
        };
        const follows = this.followedRenameAt(pointer);

        if (!follows) {
          return change;
        }

        return { ...change, follows };
      },
    );
  }

  private listedFieldChanges(): readonly FieldChange[] {
    const { fieldChanges } = this.entry;
    const { fieldsPerRow } = this.listing;

    if (fieldsPerRow === undefined) {
      return fieldChanges;
    }

    return fieldChanges.slice(0, fieldsPerRow);
  }

  // A side without the value is the Head side of an added value and the Draft side of a removed one.
  private valuesOf(
    changeType: DraftFieldChangeType,
    oldValue: unknown,
    newValue: unknown,
  ): FieldValues {
    const { maxValueBytes } = this.listing;

    if (maxValueBytes === undefined) {
      return { oldValue, newValue };
    }

    return limitedValuesOf(
      sideWithin(
        oldValue,
        changeType !== RowChangeDetailType.FieldAdded,
        maxValueBytes,
      ),
      sideWithin(
        newValue,
        changeType !== RowChangeDetailType.FieldRemoved,
        maxValueBytes,
      ),
    );
  }

  private fieldSelectionAt(pointer: JsonPointer): FieldSelection {
    const match = this.catalogue.matchField(this.row, {
      tableId: publicTableIdOf(this.entry.table),
      rowId: this.row.rowId,
      path: pointer.toString(),
    });

    if (isComputed(match)) {
      return COMPUTED;
    }

    const units = this.unitsMatched(match);
    const existence = units.find(isExistenceUnit);

    if (existence) {
      return this.goesWith(existence, 'rowExistence');
    }

    const structure = units.find(({ unit }) => unit.kind === 'structure');

    if (structure) {
      return this.goesWith(structure, this.structureReason());
    }

    const [field] = units;

    if (!field && this.isComputedInsideAtomicValue(pointer)) {
      return COMPUTED;
    }

    if (!field) {
      throw new Error(
        `${this.address()}${pointer.toString()} changed but matches no unit`,
      );
    }

    return { state: 'unit', unit: unitRefOf(field) };
  }

  // A value inside an atomic array or File that only the computation changed: the stored values are equal.
  private isComputedInsideAtomicValue(pointer: JsonPointer): boolean {
    const { head, draft } = this.entry;

    return (
      this.catalogue.isInsideAtomicValue(this.row, pointer) &&
      deepEqual(pointer.valueIn(head?.data), pointer.valueIn(draft?.data))
    );
  }

  private unitsMatched({ selected, required }: SelectorMatch): CatalogueUnit[] {
    return [...selected, ...required.map(({ key }) => key)].map((key) =>
      this.catalogue.unit(key),
    );
  }

  private columns(
    selectionOf: (column: RowColumn) => FieldSelection,
  ): DraftColumnChange[] {
    const { head, draft } = this.entry;

    if (!head || !draft) {
      return [];
    }

    return differingColumnsOf(head, draft)
      .filter((column): column is RowColumn => column !== 'id')
      .map((column) => ({
        column,
        oldValue: head[column],
        newValue: draft[column],
        selection: selectionOf(column),
      }));
  }

  // A column the catalogue does not own goes with the structure: the structure owns it or the row is not loaded.
  private columnSelectionOf(column: RowColumn): FieldSelection {
    const owner = this.loadedRow()?.columns.get(column);

    if (owner === undefined) {
      return this.goesWithStructure('structureBound');
    }

    const unit = this.catalogue.unit(owner);

    if (unit.unit.kind === 'structure') {
      return this.goesWith(unit, 'structureBound');
    }

    return { state: 'unit', unit: unitRefOf(unit) };
  }

  private loadedRow(): CatalogueRow | undefined {
    return this.catalogue.changedRowOf(
      this.entry.table,
      this.entry.pair.identity,
    );
  }

  private goesWithStructure(reason: GoesWithReason): GoesWithSelection {
    const structure = this.catalogue.structureOf(this.entry.table);

    if (!structure) {
      throw new Error(
        `${this.address()} has no unit and its table has no structure unit`,
      );
    }

    return this.goesWith(structure, reason);
  }

  private goesWith(
    unit: CatalogueUnit,
    reason: GoesWithReason,
  ): GoesWithSelection {
    return { state: 'goesWith', unit: this.catalogue.describe(unit), reason };
  }

  private structureReason(): GoesWithReason {
    if (isCreatedOrRemoved(this.entry.table)) {
      return 'tableExistence';
    }

    return 'structureBound';
  }

  private address(): string {
    return `${publicTableIdOf(this.entry.table)}/${this.row.rowId}`;
  }
}

function sideWithin(
  value: unknown,
  present: boolean,
  maxValueBytes: number,
): SideValue {
  if (!present) {
    return NO_VALUE;
  }

  return cutValueOf(value, maxValueBytes);
}

function limitedValuesOf(old: SideValue, next: SideValue): FieldValues {
  const values: FieldValues = {
    oldValue: old.value,
    newValue: next.value,
    oldValueBytes: old.bytes,
    newValueBytes: next.bytes,
    oldValueToken: old.token,
    newValueToken: next.token,
  };

  if (old.cut) {
    values.oldValueCut = old.cut;
  }

  if (next.cut) {
    values.newValueCut = next.cut;
  }

  return values;
}

// The pointers from the first segment down to the pointer itself.
function pointersAlong(pointer: JsonPointer): JsonPointer[] {
  const pointers: JsonPointer[] = [];
  let current = JsonPointer.root;

  for (const segment of pointer.segments) {
    current = current.child(segment);
    pointers.push(current);
  }

  return pointers;
}

function arrayLengthOf(value: unknown): number | null {
  if (!Array.isArray(value)) {
    return null;
  }

  return value.length;
}

function withoutOwnUnits(
  selection: RefusedSelection | GoesWithSelection,
): RowSelection {
  return { ...selection, units: [] };
}

function timeOf(changedAt: string | null): Date | null {
  if (changedAt === null) {
    return null;
  }

  return new Date(changedAt);
}

function rowIdsOf({ head, draft }: DraftRowEntry): RowIds {
  if (!draft) {
    return { rowId: requiredVersion(head).id };
  }

  if (!head || head.id === draft.id) {
    return { rowId: draft.id };
  }

  return { rowId: draft.id, previousRowId: head.id };
}

function requiredVersion(row: Row | undefined): Row {
  if (!row) {
    throw new Error('A reported row has no version on either side');
  }

  return row;
}

function addressedRowOf({ table, head, draft }: DraftRowEntry): AddressedRow {
  if (draft) {
    return { table, rowId: draft.id, side: 'draft' };
  }

  if (head) {
    return { table, rowId: head.id, side: 'head' };
  }

  throw new Error(`A reported row of ${publicTableIdOf(table)} has no version`);
}

function draftFieldChangeTypeOf(
  changeType: RowChangeDetailType,
): DraftFieldChangeType {
  if (changeType === RowChangeDetailType.FieldMoved) {
    throw new Error('The row value diff reported a moved field');
  }

  return changeType;
}

function isComputed({ blockers }: SelectorMatch): boolean {
  return blockers.some(({ code }) => code === 'notSelectable');
}
