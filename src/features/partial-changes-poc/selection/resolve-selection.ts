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
  private readonly draftTables = new Map<string, CatalogueTable>();
  private readonly headTables = new Map<string, CatalogueTable>();

  constructor(private readonly catalogue: ChangeCatalogue) {
    for (const table of catalogue.tables.values()) {
      if (table.pair.draft) {
        this.draftTables.set(table.pair.draft.id, table);
      }
      if (table.pair.head) {
        this.headTables.set(table.pair.head.id, table);
      }
    }
  }

  private tableById(tableId: string): CatalogueTable | undefined {
    return this.draftTables.get(tableId) ?? this.headTables.get(tableId);
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
    const table = this.tableById(tableId);
    const unit =
      kind === 'structure'
        ? (table?.structureUnit ?? this.transientStructureUnit(tableId))
        : table?.viewsUnit;
    if (unit) {
      result.keys.add(unit);
      return;
    }
    addUnmatched(result, item, tableId);
  }

  private transientStructureUnit(tableId: string): string | undefined {
    return [...this.catalogue.units.values()].find(
      (unit) =>
        unit.kind === 'structure' &&
        unit.tableId === tableId &&
        !this.catalogue.tables.has(unit.tableCreatedId),
    )?.key;
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
    const table = this.tableById(tableId);
    if (table?.kind === 'whole') {
      this.requireStructure(table, result, undefined, undefined);
      return;
    }

    if (!table || table.unitKeys.length === 0 || table.kind === 'system') {
      addUnmatched(result, 'tableData', tableId);
      return;
    }

    table.unitKeys.forEach((key) => result.keys.add(key));
  }

  private resolveRow(selector: RowSelector, result: ItemsResolution): void {
    const table = this.tableById(selector.tableId);
    if (table?.kind === 'whole') {
      this.requireStructure(table, result, selector.rowId, undefined);
      return;
    }

    const row = table
      ? findRow(table, selector.rowId, selector.side)
      : undefined;
    if (!row) {
      addUnmatched(result, 'rows', selector);
      return;
    }

    rowUnitKeys(row).forEach((key) => result.keys.add(key));
  }

  private resolveField(selector: FieldSelector, result: ItemsResolution): void {
    const table = this.tableById(selector.tableId);
    if (table?.kind === 'whole') {
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
    const matchedUnits = row
      ? this.resolveFieldUnits(row, selector, result)
      : false;
    const matchedStructure = table
      ? this.requireStructureForChangedFields(table, selector, result)
      : false;
    if (!matchedUnits && !matchedStructure) {
      addUnmatched(result, 'fields', selector);
    }
  }

  private requireStructureForChangedFields(
    table: CatalogueTable,
    selector: FieldSelector,
    result: ItemsResolution,
  ): boolean {
    const changed = table.changedPointers.find(
      (pointer) =>
        isSameOrInside(pointer, selector.path) ||
        isSameOrInside(selector.path, pointer),
    );
    if (!changed || !table.structureUnit) {
      return false;
    }

    this.requireStructure(table, result, selector.rowId, changed);
    return true;
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
    const key = table.structureUnit;
    if (!key) {
      return;
    }
    result.required.set(key, {
      code: 'structureBoundData',
      tableId: table.tableId,
      rowId,
      path,
      because: path
        ? `${table.tableId}${path} is a new or changed field; its values are committed and reverted with the structure of ${table.tableId}`
        : `the rows of ${table.tableId} exist only with its structure (created or removed table)`,
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
  side?: 'head',
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
  if (side === 'head') {
    return index.head.get(rowId);
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
