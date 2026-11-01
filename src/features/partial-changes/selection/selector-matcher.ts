import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { UnitKind } from 'src/features/partial-changes/catalogue/unit';
import type {
  RefusalCode,
  RefusedTable,
} from 'src/features/partial-changes/head-schema/head-schema-check';
import type { CatalogueLookup } from 'src/features/partial-changes/selection/catalogue-lookup';
import { FieldNormalisation } from 'src/features/partial-changes/selection/field-normalisation';
import type {
  FieldRef,
  RowRef,
  SelectionItems,
  TableRef,
} from 'src/features/partial-changes/selection/selection';
import type { PlanBlocker } from 'src/features/partial-changes/selection/selection-resolution';
import {
  blocking,
  ItemsResolution,
  NO_MATCH,
  requiring,
  type SelectorMatch,
  selecting,
  selectingUnit,
} from 'src/features/partial-changes/selection/selector-match';
import type { TablePair } from 'src/features/partial-changes/snapshot/changes-snapshot';

interface ReasonSubject {
  readonly tableId: string;
  readonly rowId?: string;
  readonly path?: string;
}

const REFUSAL_REASONS: Readonly<Record<RefusalCode, string>> = {
  headSchemaInconsistent: 'its Head schema does not match its Head ledger',
  unledgeredTable: 'it has no intact ledger lineage',
};

export class SelectorMatcher {
  constructor(private readonly lookup: CatalogueLookup) {}

  public matchItems(items: SelectionItems): ItemsResolution {
    const resolution = new ItemsResolution();

    resolution.addEach('tables', items.tables, (selector) =>
      this.unlessRefused(tableRefOf(selector).tableId, () =>
        this.matchStructure(selector),
      ),
    );
    resolution.addEach('tableData', items.tableData, (tableId) =>
      this.unlessRefused(tableId, () => this.matchTableData(tableId)),
    );
    resolution.addEach('views', items.views, (tableId) =>
      this.unlessRefused(tableId, () => this.matchViews(tableId)),
    );
    resolution.addEach('sharedSchemas', items.sharedSchemas, (id) =>
      selectingUnit(this.lookup.unitWithoutTable('sharedSchema', id)),
    );
    resolution.addEach('rows', items.rows, (selector) =>
      this.unlessRefused(selector.tableId, () => this.matchRow(selector)),
    );
    resolution.addEach('renames', items.renames, (selector) =>
      this.unlessRefused(selector.tableId, () =>
        this.matchRowUnit(selector, 'rowRename'),
      ),
    );
    resolution.addEach('rowColumns', items.rowColumns, (selector) =>
      this.unlessRefused(selector.tableId, () =>
        this.matchRowUnit(selector, 'rowColumns'),
      ),
    );
    resolution.addEach('fields', items.fields, (selector) =>
      this.unlessRefused(selector.tableId, () => this.matchField(selector)),
    );

    return resolution;
  }

  private unlessRefused(
    tableId: string,
    match: () => SelectorMatch,
  ): SelectorMatch {
    const refusals = this.lookup.refusalsNaming(tableId);

    if (refusals.length > 0) {
      return blocking(refusals.map(refusalBlocker));
    }

    return match();
  }

  private matchStructure(selector: TableRef): SelectorMatch {
    const { tableId, side } = tableRefOf(selector);
    const table = this.lookup.tableNamed(tableId, side);

    if (table) {
      return selectingUnit(this.lookup.tableUnitOf('structure', table));
    }

    if (side === 'head') {
      return NO_MATCH;
    }

    return selectingUnit(this.lookup.unitWithoutTable('structure', tableId));
  }

  private matchTableData(tableId: string): SelectorMatch {
    const table = this.lookup.tableNamed(tableId);

    if (!table) {
      return NO_MATCH;
    }

    if (isCreatedOrRemoved(table)) {
      return this.requireStructureOfCreatedOrRemoved(table, { tableId });
    }

    return selecting(this.lookup.rowLevelUnitsOf(table));
  }

  private matchViews(tableId: string): SelectorMatch {
    const table = this.lookup.tableNamed(tableId);

    return selectingUnit(table && this.lookup.tableUnitOf('views', table));
  }

  private matchRow(selector: RowRef): SelectorMatch {
    const table = this.lookup.tableNamed(selector.tableId);

    if (table && isCreatedOrRemoved(table)) {
      const { tableId, rowId } = selector;

      return this.requireStructureOfCreatedOrRemoved(table, { tableId, rowId });
    }

    return selecting(this.unitsOfRowNamed(selector));
  }

  private matchRowUnit(selector: RowRef, kind: UnitKind): SelectorMatch {
    return selecting(
      this.unitsOfRowNamed(selector).filter(({ unit }) => unit.kind === kind),
    );
  }

  private matchField(selector: FieldRef): SelectorMatch {
    const table = this.lookup.tableNamed(selector.tableId);

    if (!table) {
      return NO_MATCH;
    }

    if (isCreatedOrRemoved(table)) {
      return this.requireStructureOfCreatedOrRemoved(table, selector);
    }

    return new FieldNormalisation(this.lookup, table, selector).match();
  }

  private unitsOfRowNamed({ tableId, rowId, side }: RowRef): CatalogueUnit[] {
    const table = this.lookup.tableNamed(tableId);
    const row = table && this.lookup.rowNamed(table, rowId, side);

    if (!row) {
      return [];
    }

    return this.lookup.unitsOfRow(row);
  }

  private requireStructureOfCreatedOrRemoved(
    table: TablePair,
    { tableId, rowId, path }: ReasonSubject,
  ): SelectorMatch {
    return requiring(this.lookup.tableUnitOf('structure', table), {
      code: 'structureBoundData',
      tableId,
      rowId,
      path,
      because: `the rows of ${tableId} exist only with its structure (created or removed table)`,
    });
  }
}

export function refusalBlocker({ tableId, code }: RefusedTable): PlanBlocker {
  return {
    code,
    tableId,
    message: `${tableId} is refused: ${REFUSAL_REASONS[code]}`,
  };
}

function tableRefOf(selector: TableRef): Exclude<TableRef, string> {
  if (typeof selector === 'string') {
    return { tableId: selector };
  }

  return selector;
}

function isCreatedOrRemoved({ head, draft }: TablePair): boolean {
  return head === undefined || draft === undefined;
}
