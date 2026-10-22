import objectHash from 'object-hash';
import {
  CatalogueRow,
  CatalogueTable,
  CatalogueUnit,
  ChangeCatalogue,
} from 'src/features/partial-changes-poc/catalogue/change-catalogue.types';
import {
  collectSchemaLeaves,
  diffLeafPointers,
} from 'src/features/partial-changes-poc/catalogue/schema-leaves';
import {
  ChangesSnapshot,
  RowPair,
  TablePair,
} from 'src/features/partial-changes-poc/snapshot/snapshot.types';
import { SystemTables } from 'src/features/share/system-tables.consts';

export function buildChangeCatalogue(
  snapshot: ChangesSnapshot,
): ChangeCatalogue {
  return new CatalogueBuilder(snapshot).build();
}

type MigrationData = { tableId?: string; nextTableId?: string };

class CatalogueBuilder {
  private readonly units = new Map<string, CatalogueUnit>();
  private readonly tables = new Map<string, CatalogueTable>();
  private readonly userTables: TablePair[];
  private readonly systemTables: TablePair[];
  private readonly headIds = new Map<string, TablePair>();
  private readonly draftIds = new Map<string, TablePair>();
  private readonly structureTables = new Set<string>();
  private readonly systemUnits = new Map<string, string[]>();

  constructor(private readonly snapshot: ChangesSnapshot) {
    this.systemTables = snapshot.tables.filter((pair) => isSystem(pair));
    this.userTables = snapshot.tables.filter((pair) => !isSystem(pair));
  }

  build(): ChangeCatalogue {
    this.indexUserTables();
    this.systemTables.forEach((pair) => this.attributeSystemChanges(pair));
    this.userTables.forEach((pair) => this.catalogueUserTable(pair));
    this.systemTables.forEach((pair) => this.catalogueSystemTable(pair));
    return { units: this.units, tables: this.tables };
  }

  private indexUserTables(): void {
    for (const pair of this.userTables) {
      if (pair.head) {
        this.headIds.set(pair.head.id, pair);
      }
      if (pair.draft) {
        this.draftIds.set(pair.draft.id, pair);
      }
    }
  }

  private attributeSystemChanges(pair: TablePair): void {
    const systemTableId = publicTableId(pair);
    const keys = pair.changedRows.flatMap((row) =>
      this.unitsForSystemRow(systemTableId, row),
    );
    this.systemUnits.set(pair.createdId, [...new Set(keys)]);
  }

  private unitsForSystemRow(systemTableId: string, row: RowPair): string[] {
    const ids = [row.draft?.id, row.head?.id].filter(isDefined);

    switch (systemTableId) {
      case SystemTables.Schema:
        return [this.structureUnitFor(ids)];
      case SystemTables.Migration:
        return [this.structureUnitFor(migrationTableIds(row))];
      case SystemTables.Views:
        return [this.viewsUnitFor(ids)];
      default:
        return [this.sharedSchemaUnitFor(row)];
    }
  }

  private structureUnitFor(tableIds: string[]): string {
    const pair = this.resolveUserTable(tableIds);
    const tableCreatedId = pair?.createdId ?? `orphan:${tableIds[0] ?? ''}`;
    if (pair) {
      this.structureTables.add(pair.createdId);
    }
    return this.addUnit({
      key: `t:${tableCreatedId}/structure`,
      kind: 'structure',
      tableCreatedId,
      tableId: pair ? publicTableId(pair) : (tableIds[0] ?? ''),
      rowCreatedIds: [],
    });
  }

  private viewsUnitFor(tableIds: string[]): string {
    const pair = this.resolveUserTable(tableIds);
    const tableCreatedId = pair?.createdId ?? `orphan:${tableIds[0] ?? ''}`;
    return this.addUnit({
      key: `t:${tableCreatedId}/views`,
      kind: 'views',
      tableCreatedId,
      tableId: pair ? publicTableId(pair) : (tableIds[0] ?? ''),
      rowCreatedIds: [],
    });
  }

  private sharedSchemaUnitFor(row: RowPair): string {
    return this.addUnit({
      key: `s:${row.createdId}/sharedSchema`,
      kind: 'sharedSchema',
      tableCreatedId: `shared:${row.createdId}`,
      tableId: (row.draft ?? row.head)?.id ?? '',
      rowCreatedIds: [row.createdId],
    });
  }

  private resolveUserTable(tableIds: string[]): TablePair | undefined {
    for (const id of tableIds) {
      const pair = this.draftIds.get(id) ?? this.headIds.get(id);
      if (pair) {
        return pair;
      }
    }
    return undefined;
  }

  private catalogueUserTable(pair: TablePair): void {
    if (this.hasStructureChange(pair)) {
      const key = `t:${pair.createdId}/structure`;
      this.structureTables.add(pair.createdId);
      this.addUnit({
        key,
        kind: 'structure',
        tableCreatedId: pair.createdId,
        tableId: publicTableId(pair),
        rowCreatedIds: [],
      });
      this.addTable(pair, 'structure', [key]);
      return;
    }

    if (pair.head?.versionId === pair.draft?.versionId) {
      this.addTable(pair, 'unchanged', []);
      return;
    }

    this.catalogueDataTable(pair);
  }

  private hasStructureChange(pair: TablePair): boolean {
    if (!pair.head || !pair.draft || pair.head.id !== pair.draft.id) {
      return true;
    }

    if (this.structureTables.has(pair.createdId)) {
      return true;
    }

    return (
      objectHash(pair.headSchema ?? {}) !== objectHash(pair.draftSchema ?? {})
    );
  }

  private catalogueDataTable(pair: TablePair): void {
    const table = this.addTable(pair, 'data', []);
    const headOnly = indexById(pair.changedRows, 'head');
    const draftOnly = indexById(pair.changedRows, 'draft');

    for (const rowPair of pair.changedRows) {
      const row = this.rowFor(table, rowPair);
      this.catalogueRow(table, row, headOnly, draftOnly);
    }

    table.unitKeys = [...new Set(table.unitKeys)];
  }

  private rowFor(table: CatalogueTable, pair: RowPair): CatalogueRow {
    const existing = table.rows.get(pair.createdId);
    if (existing) {
      return existing;
    }

    const row: CatalogueRow = { pair, fieldUnits: new Map() };
    table.rows.set(pair.createdId, row);
    return row;
  }

  private catalogueRow(
    table: CatalogueTable,
    row: CatalogueRow,
    headOnly: Map<string, RowPair>,
    draftOnly: Map<string, RowPair>,
  ): void {
    const { head, draft } = row.pair;

    if (draft && !head) {
      this.catalogueCreatedRow(table, row, headOnly.get(draft.id));
      return;
    }

    if (head && !draft) {
      if (!draftOnly.has(head.id)) {
        row.existenceUnit = this.addTableUnit(
          table,
          {
            key: `${rowKey(table, row)}/delete`,
            kind: 'rowDelete',
            rowId: head.id,
          },
          [row.pair.createdId],
        );
      }
      return;
    }

    this.catalogueChangedRow(table, row);
  }

  private catalogueCreatedRow(
    table: CatalogueTable,
    row: CatalogueRow,
    replaced: RowPair | undefined,
  ): void {
    const rowId = row.pair.draft?.id ?? '';

    if (!replaced) {
      row.existenceUnit = this.addTableUnit(
        table,
        { key: `${rowKey(table, row)}/create`, kind: 'rowCreate', rowId },
        [row.pair.createdId],
      );
      return;
    }

    const replacedRow = this.rowFor(table, replaced);
    const key = this.addTableUnit(
      table,
      {
        key: `t:${table.pair.createdId}/r:${replaced.createdId}+${row.pair.createdId}/replace`,
        kind: 'rowReplace',
        rowId,
      },
      [replaced.createdId, row.pair.createdId],
    );
    row.existenceUnit = key;
    replacedRow.existenceUnit = key;
  }

  private catalogueChangedRow(table: CatalogueTable, row: CatalogueRow): void {
    const { head, draft } = row.pair;
    if (!head || !draft) {
      return;
    }

    if (head.id !== draft.id) {
      row.renameUnit = this.addTableUnit(
        table,
        {
          key: `${rowKey(table, row)}/rename`,
          kind: 'rowRename',
          rowId: draft.id,
          previousRowId: head.id,
        },
        [row.pair.createdId],
      );
    }

    for (const path of diffLeafPointers(table.leaves, head.data, draft.data)) {
      const key = this.addTableUnit(
        table,
        {
          key: `${rowKey(table, row)}/f:${path}`,
          kind: 'field',
          rowId: draft.id,
          path,
        },
        [row.pair.createdId],
      );
      row.fieldUnits.set(path, key);
    }
  }

  private catalogueSystemTable(pair: TablePair): void {
    const kind =
      pair.head?.versionId === pair.draft?.versionId ? 'unchanged' : 'system';
    this.addTable(pair, kind, this.systemUnits.get(pair.createdId) ?? []);
  }

  private addTable(
    pair: TablePair,
    kind: CatalogueTable['kind'],
    unitKeys: string[],
  ): CatalogueTable {
    const schema = pair.draftSchema ?? pair.headSchema;
    const table: CatalogueTable = {
      pair,
      kind,
      tableId: publicTableId(pair),
      schema,
      leaves: schema && kind === 'data' ? collectSchemaLeaves(schema) : [],
      rows: new Map(),
      unitKeys,
    };
    this.tables.set(pair.createdId, table);
    return table;
  }

  private addTableUnit(
    table: CatalogueTable,
    unit: Pick<
      CatalogueUnit,
      'key' | 'kind' | 'rowId' | 'previousRowId' | 'path'
    >,
    rowCreatedIds: string[],
  ): string {
    const key = this.addUnit({
      ...unit,
      tableCreatedId: table.pair.createdId,
      tableId: table.tableId,
      rowCreatedIds,
    });
    table.unitKeys.push(key);
    return key;
  }

  private addUnit(unit: CatalogueUnit): string {
    if (!this.units.has(unit.key)) {
      this.units.set(unit.key, unit);
    }
    return unit.key;
  }
}

function isSystem(pair: TablePair): boolean {
  return Boolean((pair.head ?? pair.draft)?.system);
}

export function publicTableId(pair: TablePair): string {
  return (pair.draft ?? pair.head)?.id ?? '';
}

function rowKey(table: CatalogueTable, row: CatalogueRow): string {
  return `t:${table.pair.createdId}/r:${row.pair.createdId}`;
}

function indexById(
  rows: RowPair[],
  onlySide: 'head' | 'draft',
): Map<string, RowPair> {
  const index = new Map<string, RowPair>();
  for (const row of rows) {
    const present = onlySide === 'head' ? row.head : row.draft;
    const absent = onlySide === 'head' ? row.draft : row.head;
    if (present && !absent) {
      index.set(present.id, row);
    }
  }
  return index;
}

function migrationTableIds(row: RowPair): string[] {
  return [row.draft, row.head]
    .filter(isDefined)
    .flatMap((version) => {
      const data = version.data as MigrationData;
      return [data.nextTableId, data.tableId];
    })
    .filter(isDefined);
}

function isDefined<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null;
}
