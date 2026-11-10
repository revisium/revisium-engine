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
import type {
  RenamedRow,
  RowRenames,
} from 'src/features/partial-changes/draft-reads/row-renames';
import { tableIdsOf } from 'src/features/partial-changes/draft-reads/table-ids';
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
  DraftColumnChange,
  DraftFieldChange,
  DraftFieldChangeType,
  DraftRowItem,
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
import type { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';
import {
  type FieldChange,
  RowChangeDetailType,
} from 'src/features/revision-changes/types';

// A reported row of a page: its pair, its stored versions and the native field changes of its computed values.
export interface DraftRowEntry {
  readonly table: TablePair;
  readonly pair: ReportedRowPair;
  readonly head?: Row;
  readonly draft?: Row;
  readonly fieldChanges: readonly FieldChange[];
}

type RowIds = Pick<DraftRowItem, 'rowId' | 'previousRowId'>;
type ItemIds = Pick<DraftRowItem, 'tableId' | 'previousTableId'> & RowIds;

const COMPUTED = { state: 'computed' } as const;

export function draftRowItemOf(
  entry: DraftRowEntry,
  catalogue: DraftCatalogue,
  renames: RowRenames,
): DraftRowItem {
  return new DraftRow(entry, catalogue, renames).item();
}

class DraftRow {
  private readonly row: AddressedRow;

  constructor(
    private readonly entry: DraftRowEntry,
    private readonly catalogue: DraftCatalogue,
    private readonly renames: RowRenames,
  ) {
    this.row = addressedRowOf(entry);
  }

  public item(): DraftRowItem {
    const refusal = this.catalogue.refusalOf(this.entry.table);

    if (refusal) {
      return this.refusedItem(refusal);
    }

    return this.withIdLinks({
      ...this.ids(),
      changeType: this.entry.pair.changeType,
      fields: this.fields((pointer) => this.fieldSelectionAt(pointer)),
      columns: this.columns((column) => this.columnSelectionOf(column)),
      selection: this.selection(),
    });
  }

  private refusedItem({ code }: RefusedTable): DraftRowItem {
    const refused: RefusedSelection = { state: 'refused', code };

    return {
      ...this.ids(),
      changeType: this.entry.pair.changeType,
      fields: this.fields(() => refused),
      columns: this.columns(() => refused),
      selection: withoutOwnUnits(refused),
    };
  }

  private withIdLinks(item: DraftRowItem): DraftRowItem {
    const idTakeover = this.idTakeover();
    const idExchange = this.idExchange();
    const linked = idTakeover ? { ...item, idTakeover } : item;

    return idExchange ? { ...linked, idExchange } : linked;
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
      renames: chain.renames.map((renamed) => {
        const rename = this.renameUnitOf(renamed);

        if (!rename) {
          throw new Error(
            `${this.address()} exchanges ids with ${renamed.rowId}, which has no rename unit`,
          );
        }

        return rename;
      }),
      termination: chain.termination,
    };
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

  private ids(): ItemIds {
    return { ...tableIdsOf(this.entry.table), ...rowIdsOf(this.entry) };
  }

  private selection(): RowSelection {
    if (isCreatedOrRemoved(this.entry.table)) {
      return withoutOwnUnits(this.goesWithStructure('tableExistence'));
    }

    const units = this.catalogue.unitsOfRow(this.row).sort(compareUnits);

    if (units.length > 0) {
      return this.selectableRow(units);
    }

    if (this.loadedRow()) {
      return withoutOwnUnits(COMPUTED);
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
    return this.entry.fieldChanges.map(
      ({ fieldPath, changeType, oldValue, newValue }) => {
        const pointer = pointerOfNativeFieldPath(fieldPath);
        const change: DraftFieldChange = {
          path: pointer.toString(),
          changeType: draftFieldChangeTypeOf(changeType),
          oldValue: oldValue ?? null,
          newValue: newValue ?? null,
          selection: selectionAt(pointer),
        };
        const follows = this.followedRenameAt(pointer);

        return follows ? { ...change, follows } : change;
      },
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

function withoutOwnUnits(
  selection: RefusedSelection | GoesWithSelection | typeof COMPUTED,
): RowSelection {
  return { ...selection, units: [] };
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
