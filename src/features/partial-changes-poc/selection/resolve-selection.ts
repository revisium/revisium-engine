import {
  CatalogueRow,
  CatalogueTable,
  ChangeCatalogue,
} from 'src/features/partial-changes-poc/catalogue/change-catalogue.types';
import { isSameOrInside } from 'src/features/partial-changes-poc/catalogue/json-pointer';
import { findComputedLeaf } from 'src/features/partial-changes-poc/catalogue/schema-leaves';
import {
  Blocker,
  FieldSelector,
  RequiredReason,
  RowSelector,
  Selection,
  SelectionItems,
} from 'src/features/partial-changes-poc/partial-changes.types';

export interface SelectionResolution {
  selected: Set<string>;
  excluded: Set<string>;
  required: Map<string, RequiredReason>;
  blockers: Blocker[];
  unmatched: SelectionItems;
}

interface ItemsResolution {
  keys: Set<string>;
  required: Map<string, RequiredReason>;
  blockers: Blocker[];
  unmatched: SelectionItems;
}

export function resolveSelection(
  catalogue: ChangeCatalogue,
  selection: Selection,
): SelectionResolution {
  const resolver = new ItemsResolver(catalogue);
  const included = resolver.resolve(selection);
  const excludedItems = resolver.resolve(selection.exclude ?? {});
  const excluded = new Set([
    ...excludedItems.keys,
    ...excludedItems.required.keys(),
  ]);

  if (selection.all) {
    catalogue.units.forEach((_unit, key) => included.keys.add(key));
  }

  const selected = new Set(
    [...included.keys].filter((key) => !excluded.has(key)),
  );
  const required = new Map(
    [...included.required].filter(([key]) => !selected.has(key)),
  );
  const blockers = [...included.blockers];

  for (const [key, reason] of required) {
    if (excluded.has(key)) {
      required.delete(key);
      blockers.push(requiredExcludedBlocker(reason));
    }
  }

  return {
    selected,
    excluded,
    required,
    blockers,
    unmatched: included.unmatched,
  };
}

export function requiredExcludedBlocker(reason: RequiredReason): Blocker {
  return {
    code: 'requiredExcluded',
    tableId: reason.tableId,
    rowId: reason.rowId,
    path: reason.path,
    message: `A required unit is excluded: ${reason.because}`,
  };
}

class ItemsResolver {
  private readonly tablesById = new Map<string, CatalogueTable>();

  constructor(private readonly catalogue: ChangeCatalogue) {
    for (const table of catalogue.tables.values()) {
      for (const id of [table.pair.head?.id, table.pair.draft?.id]) {
        if (id && !this.tablesById.has(id)) {
          this.tablesById.set(id, table);
        }
      }
      this.tablesById.set(table.tableId, table);
    }
  }

  resolve(items: SelectionItems): ItemsResolution {
    const result: ItemsResolution = {
      keys: new Set(),
      required: new Map(),
      blockers: [],
      unmatched: {},
    };

    items.tables?.forEach((id) =>
      this.resolveTableUnit(id, 'structure', 'tables', result),
    );
    items.views?.forEach((id) =>
      this.resolveTableUnit(id, 'views', 'views', result),
    );
    items.sharedSchemas?.forEach((id) => this.resolveSharedSchema(id, result));
    items.tableData?.forEach((id) => this.resolveTableData(id, result));
    items.rows?.forEach((selector) => this.resolveRow(selector, result));
    items.fields?.forEach((selector) => this.resolveField(selector, result));

    return result;
  }

  private resolveTableUnit(
    tableId: string,
    kind: 'structure' | 'views',
    item: 'tables' | 'views',
    result: ItemsResolution,
  ): void {
    const unit = [...this.catalogue.units.values()].find(
      (candidate) => candidate.kind === kind && candidate.tableId === tableId,
    );
    if (unit) {
      result.keys.add(unit.key);
      return;
    }
    addUnmatched(result, item, tableId);
  }

  private resolveSharedSchema(id: string, result: ItemsResolution): void {
    const unit = [...this.catalogue.units.values()].find(
      (candidate) =>
        candidate.kind === 'sharedSchema' && candidate.tableId === id,
    );
    if (unit) {
      result.keys.add(unit.key);
      return;
    }
    addUnmatched(result, 'sharedSchemas', id);
  }

  private resolveTableData(tableId: string, result: ItemsResolution): void {
    const table = this.tablesById.get(tableId);
    if (!table || table.kind === 'unchanged' || table.kind === 'system') {
      addUnmatched(result, 'tableData', tableId);
      return;
    }

    if (table.kind === 'structure') {
      this.requireStructure(table, result, undefined, undefined);
      return;
    }

    table.unitKeys.forEach((key) => result.keys.add(key));
  }

  private resolveRow(selector: RowSelector, result: ItemsResolution): void {
    const table = this.tablesById.get(selector.tableId);
    if (table?.kind === 'structure') {
      this.requireStructure(table, result, selector.rowId, undefined);
      return;
    }

    const row = table ? findRow(table, selector.rowId) : undefined;
    if (!row) {
      addUnmatched(result, 'rows', selector);
      return;
    }

    rowUnitKeys(row).forEach((key) => result.keys.add(key));
  }

  private resolveField(selector: FieldSelector, result: ItemsResolution): void {
    const table = this.tablesById.get(selector.tableId);
    if (table?.kind === 'structure') {
      this.requireStructure(table, result, selector.rowId, selector.path);
      return;
    }

    const computed = table
      ? findComputedLeaf(table.leaves, selector.path)
      : undefined;
    if (computed) {
      result.blockers.push({
        code: 'notSelectable',
        tableId: selector.tableId,
        rowId: selector.rowId,
        path: selector.path,
        message: `${selector.path} is computed (formula or system field) and follows its inputs`,
      });
      return;
    }

    const row = table ? findRow(table, selector.rowId) : undefined;
    if (!row || !this.resolveFieldUnits(row, selector, result)) {
      addUnmatched(result, 'fields', selector);
    }
  }

  private resolveFieldUnits(
    row: CatalogueRow,
    selector: FieldSelector,
    result: ItemsResolution,
  ): boolean {
    if (row.existenceUnit) {
      result.required.set(row.existenceUnit, {
        code: 'wholeRowUnit',
        tableId: selector.tableId,
        rowId: selector.rowId,
        path: selector.path,
        because: `${selector.tableId}/${selector.rowId} is created, deleted or replaced as a whole row`,
      });
      return true;
    }

    let matched = false;
    for (const [path, key] of row.fieldUnits) {
      if (isSameOrInside(path, selector.path)) {
        result.keys.add(key);
        matched = true;
      } else if (isSameOrInside(selector.path, path)) {
        result.required.set(key, {
          code: 'atomicValue',
          tableId: selector.tableId,
          rowId: selector.rowId,
          path,
          because: `${selector.path} is inside the atomic value ${path} (file or array)`,
        });
        matched = true;
      }
    }
    return matched;
  }

  private requireStructure(
    table: CatalogueTable,
    result: ItemsResolution,
    rowId: string | undefined,
    path: string | undefined,
  ): void {
    const [key] = table.unitKeys;
    if (!key) {
      return;
    }
    result.required.set(key, {
      code: 'structureBoundData',
      tableId: table.tableId,
      rowId,
      path,
      because: `${table.tableId} has a structure change; in M1 its data is committed only together with the structure`,
    });
  }
}

const rowIndexes = new WeakMap<
  CatalogueTable,
  { draft: Map<string, CatalogueRow>; head: Map<string, CatalogueRow> }
>();

export function findRow(
  table: CatalogueTable,
  rowId: string,
): CatalogueRow | undefined {
  let index = rowIndexes.get(table);
  if (!index) {
    index = { draft: new Map(), head: new Map() };
    for (const row of table.rows.values()) {
      if (row.pair.draft) {
        index.draft.set(row.pair.draft.id, row);
      }
      if (row.pair.head) {
        index.head.set(row.pair.head.id, row);
      }
    }
    rowIndexes.set(table, index);
  }
  return index.draft.get(rowId) ?? index.head.get(rowId);
}

export function rowUnitKeys(row: CatalogueRow): string[] {
  return [row.existenceUnit, row.renameUnit, ...row.fieldUnits.values()].filter(
    (key): key is string => key !== undefined,
  );
}

function addUnmatched<K extends keyof SelectionItems>(
  result: ItemsResolution,
  item: K,
  value: NonNullable<SelectionItems[K]>[number],
): void {
  const list = (result.unmatched[item] ?? []) as unknown[];
  list.push(value);
  result.unmatched[item] = list as SelectionItems[K];
}
