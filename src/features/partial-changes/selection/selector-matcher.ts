import type { UnitKind } from 'src/features/partial-changes/catalogue/unit';
import type { CatalogueLookup } from 'src/features/partial-changes/selection/catalogue-lookup';
import {
  isCreatedOrRemoved,
  requireStructureOfCreatedOrRemoved,
} from 'src/features/partial-changes/selection/created-or-removed-tables';
import { FieldNormalisation } from 'src/features/partial-changes/selection/field-normalisation';
import type {
  RowRef,
  SelectionItems,
  TableRef,
} from 'src/features/partial-changes/selection/selection';
import type {
  AddressedRow,
  SelectionTargets,
} from 'src/features/partial-changes/selection/selection-targets';
import {
  ItemsResolution,
  NO_MATCH,
  refusing,
  type SelectorMatch,
  selecting,
  selectingUnit,
} from 'src/features/partial-changes/selection/selector-match';
import type { TablePair } from 'src/features/partial-changes/snapshot/changes-snapshot';

export class SelectorMatcher {
  constructor(
    private readonly targets: SelectionTargets,
    private readonly units: CatalogueLookup,
  ) {}

  public matchItems(items: SelectionItems): ItemsResolution {
    const resolution = new ItemsResolution();

    resolution.addEach('tables', items.tables, (selector) =>
      this.matchStructure(selector),
    );
    resolution.addEach('tableData', items.tableData, (tableId) =>
      this.atTable(tableId, (table) => this.matchTableData(table, tableId)),
    );
    resolution.addEach('views', items.views, (tableId) =>
      this.atTable(tableId, (table) =>
        selectingUnit(this.units.tableUnitOf('views', table)),
      ),
    );
    resolution.addEach('sharedSchemas', items.sharedSchemas, (id) =>
      selectingUnit(this.units.unitWithoutTable('sharedSchema', id)),
    );
    resolution.addEach('rows', items.rows, (selector) =>
      this.atRow(selector, (row) => this.matchRow(row, selector)),
    );
    resolution.addEach('renames', items.renames, (selector) =>
      this.atRow(selector, (row) => this.matchRowUnit(row, 'rowRename')),
    );
    resolution.addEach('rowColumns', items.rowColumns, (selector) =>
      this.atRow(selector, (row) => this.matchRowUnit(row, 'rowColumns')),
    );
    resolution.addEach('fields', items.fields, (selector) =>
      this.atRow(selector, (row) =>
        new FieldNormalisation(this.targets, this.units, row, selector).match(),
      ),
    );

    return resolution;
  }

  private atTable(
    tableId: string,
    match: (table: TablePair) => SelectorMatch,
  ): SelectorMatch {
    const table = this.targets.tableNamed(tableId);

    if (!table) {
      return NO_MATCH;
    }

    return refusing(this.targets.refusalsOfTable(table)) ?? match(table);
  }

  private atRow(
    { tableId, rowId, side }: RowRef,
    match: (row: AddressedRow) => SelectorMatch,
  ): SelectorMatch {
    return this.atTable(tableId, (table) => {
      const row = this.targets.rowNamed(table, rowId, side);

      if (!row) {
        return NO_MATCH;
      }

      return match(row);
    });
  }

  private matchStructure(selector: TableRef): SelectorMatch {
    const { tableId, side } = tableRefOf(selector);
    const table = this.targets.tableNamed(tableId, side);

    if (table) {
      return (
        refusing(this.targets.refusalsOfStructure(table)) ??
        selectingUnit(this.units.tableUnitOf('structure', table))
      );
    }

    if (side === 'head') {
      return NO_MATCH;
    }

    return selectingUnit(this.units.unitWithoutTable('structure', tableId));
  }

  private matchTableData(table: TablePair, tableId: string): SelectorMatch {
    if (isCreatedOrRemoved(table)) {
      return requireStructureOfCreatedOrRemoved(
        this.targets,
        this.units,
        table,
        {
          tableId,
        },
      );
    }

    return selecting(this.units.rowLevelUnitsOf(table));
  }

  private matchRow(
    row: AddressedRow,
    { tableId, rowId }: RowRef,
  ): SelectorMatch {
    if (isCreatedOrRemoved(row.table)) {
      return requireStructureOfCreatedOrRemoved(
        this.targets,
        this.units,
        row.table,
        { tableId, rowId },
      );
    }

    return selecting(this.units.unitsOfRow(row));
  }

  private matchRowUnit(row: AddressedRow, kind: UnitKind): SelectorMatch {
    return selecting(
      this.units.unitsOfRow(row).filter(({ unit }) => unit.kind === kind),
    );
  }
}

function tableRefOf(selector: TableRef): Exclude<TableRef, string> {
  if (typeof selector === 'string') {
    return { tableId: selector };
  }

  return selector;
}
