import {
  CatalogueLedger,
  CatalogueRow,
  CatalogueTable,
  CatalogueUnit,
  ChangeCatalogue,
  ViewsMigrator,
  ViewsPair,
} from 'src/features/partial-changes-poc/catalogue/change-catalogue.types';
import {
  collectSchemaLeaves,
  diffLeafPointers,
} from 'src/features/partial-changes-poc/catalogue/schema-leaves';
import {
  ChangesSnapshot,
  RowPair,
  RowVersion,
  TablePair,
} from 'src/features/partial-changes-poc/snapshot/snapshot.types';
import {
  attributePending,
  LedgerAttribution,
  ledgerOf,
} from 'src/features/partial-changes-poc/structure/ledger';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { TableViewsData } from 'src/features/views/types';
import { sameJson } from 'src/features/partial-changes-poc/structure/same-json';

export function buildChangeCatalogue(
  snapshot: ChangesSnapshot,
  migrateViews: ViewsMigrator,
): ChangeCatalogue {
  return new CatalogueBuilder(snapshot, migrateViews).build();
}

type SideRowsById = {
  head: Map<string, RowVersion>;
  draft: Map<string, RowVersion>;
};

class CatalogueBuilder {
  private readonly units = new Map<string, CatalogueUnit>();
  private readonly tables = new Map<string, CatalogueTable>();
  private readonly ownedRows = new Map<string, RowVersion[]>();
  private readonly userTables: TablePair[];
  private readonly systemTables: TablePair[];
  private readonly headIds = new Map<string, TablePair>();
  private readonly draftIds = new Map<string, TablePair>();
  private readonly schemaRows = new Map<
    string,
    { head?: RowVersion; draft?: RowVersion }
  >();
  private readonly views = new Map<string, ViewsPair>();
  private readonly sharedRows = new Map<string, RowPair>();
  private readonly pendingByOwner = new Map<string, RowVersion[]>();
  private readonly ownerUnits = new Map<string, string>();
  private ledger?: CatalogueLedger;

  constructor(
    private readonly snapshot: ChangesSnapshot,
    private readonly migrateViews: ViewsMigrator,
  ) {
    this.systemTables = snapshot.tables.filter((pair) => isSystem(pair));
    this.userTables = snapshot.tables.filter((pair) => !isSystem(pair));
  }

  build(): ChangeCatalogue {
    this.indexUserTables();
    const ledger = this.buildLedger();
    this.pairSchemaRows();
    this.pairViews();
    this.userTables.forEach((pair) => this.catalogueUserTable(pair));
    this.addTransientUnits(ledger);
    this.systemTables.forEach((pair) => this.catalogueSystemTable(pair));

    return {
      units: this.units,
      tables: this.tables,
      ledger,
      schemaRows: this.schemaRows,
      views: this.views,
      sharedRows: this.sharedRows,
      ownedRows: this.ownedRows,
      ownerUnits: this.ownerUnits,
    };
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

  private buildLedger(): CatalogueLedger {
    const { migrations } = this.snapshot.system;
    const published = ledgerOf(migrations.head);
    const draftEntries = ledgerOf(migrations.draft);
    const publishedVersions = new Set(
      published.map((entry) => entry.version.versionId),
    );
    const draftVersions = new Set(
      draftEntries.map((entry) => entry.version.versionId),
    );
    const pending = draftEntries.filter(
      (entry) => !publishedVersions.has(entry.version.versionId),
    );
    const attribution = attributePending(
      pending,
      idToCreatedId(this.headIds, 'head'),
      idToCreatedId(this.draftIds, 'draft'),
    );

    for (const entry of pending) {
      const owner = attribution.ownerOf.get(entry.version.versionId) ?? '';
      const rows = this.pendingByOwner.get(owner) ?? [];
      rows.push(entry.version);
      this.pendingByOwner.set(owner, rows);
    }

    this.ledger = {
      published,
      pending,
      attribution,
      rewritten: published
        .filter((entry) => !draftVersions.has(entry.version.versionId))
        .map((entry) => entry.migration.id),
    };
    return this.ledger;
  }

  private pairSchemaRows(): void {
    const rows = byId(this.snapshot.system.schemas);
    for (const pair of this.userTables) {
      this.schemaRows.set(pair.createdId, {
        head: pair.head ? rows.head.get(pair.head.id) : undefined,
        draft: pair.draft ? rows.draft.get(pair.draft.id) : undefined,
      });
    }
  }

  private pairViews(): void {
    const rows = byId(this.snapshot.system.views);
    for (const pair of this.userTables) {
      const head = pair.head ? rows.head.get(pair.head.id) : undefined;
      const draft = pair.draft ? rows.draft.get(pair.draft.id) : undefined;
      if (!head && !draft) {
        continue;
      }
      this.views.set(pair.createdId, {
        head,
        draft,
        migratedHead: this.migratedHeadViews(pair, head),
      });
    }
  }

  private migratedHeadViews(
    pair: TablePair,
    head: RowVersion | undefined,
  ): TableViewsData | undefined {
    if (!head || !pair.draft) {
      return undefined;
    }
    const views = head.data as TableViewsData;
    return pair.structure?.differs ? this.migrateViews(views, pair) : views;
  }

  private catalogueUserTable(pair: TablePair): void {
    const structureUnit = this.structureUnitFor(pair);
    const viewsUnit = this.viewsUnitFor(pair);

    if (!pair.head || !pair.draft) {
      this.addTable(pair, 'whole', { structureUnit, viewsUnit });
      return;
    }

    const table = this.addTable(pair, 'data', { structureUnit, viewsUnit });
    if (pair.head.versionId !== pair.draft.versionId) {
      this.catalogueRows(table);
    }

    if (!structureUnit && !viewsUnit && table.unitKeys.length === 0) {
      table.kind = 'unchanged';
    }
  }

  private structureUnitFor(pair: TablePair): string | undefined {
    if (!this.hasStructureChange(pair)) {
      return undefined;
    }

    const replaced = this.replacedPartner(pair);
    const key = replaced
      ? `t:${[pair.createdId, replaced.createdId].sort().join('+')}/structure`
      : `t:${pair.createdId}/structure`;
    const renamed = Boolean(
      pair.head && pair.draft && pair.head.id !== pair.draft.id,
    );

    this.addUnit({
      key,
      kind: 'structure',
      tableCreatedId: pair.createdId,
      tableId: publicTableId(pair),
      previousTableId: renamed ? pair.head?.id : undefined,
      rowCreatedIds: [],
    });
    this.own(key, this.structureRows(pair));
    return key;
  }

  private hasStructureChange(pair: TablePair): boolean {
    if (!pair.head || !pair.draft || pair.head.id !== pair.draft.id) {
      return true;
    }

    if ((this.pendingByOwner.get(pair.createdId) ?? []).length > 0) {
      return true;
    }

    const rows = this.schemaRows.get(pair.createdId);
    return (
      rows?.head?.versionId !== rows?.draft?.versionId &&
      (rows?.head?.hash !== rows?.draft?.hash ||
        !sameJson(rows?.head?.meta, rows?.draft?.meta))
    );
  }

  private replacedPartner(pair: TablePair): TablePair | undefined {
    if (pair.head && !pair.draft) {
      const partner = this.draftIds.get(pair.head.id);
      return partner && !partner.head ? partner : undefined;
    }
    if (pair.draft && !pair.head) {
      const partner = this.headIds.get(pair.draft.id);
      return partner && !partner.draft ? partner : undefined;
    }
    return undefined;
  }

  private structureRows(pair: TablePair): RowVersion[] {
    const schema = this.schemaRows.get(pair.createdId);
    const views = this.views.get(pair.createdId);
    return [
      schema?.head,
      schema?.draft,
      views?.head,
      views?.draft,
      ...(this.pendingByOwner.get(pair.createdId) ?? []),
    ].filter(isDefined);
  }

  private viewsUnitFor(pair: TablePair): string | undefined {
    const views = this.views.get(pair.createdId);
    if (!views?.draft || !pair.draft) {
      return undefined;
    }

    const expected = views.migratedHead ?? views.head?.data;
    if (pair.head && sameJson(views.draft.data, expected)) {
      return undefined;
    }

    const key = `t:${pair.createdId}/views`;
    this.addUnit({
      key,
      kind: 'views',
      tableCreatedId: pair.createdId,
      tableId: pair.draft.id,
      rowCreatedIds: [],
    });
    const schema = this.schemaRows.get(pair.createdId);
    this.own(
      key,
      [views.head, views.draft, schema?.head, schema?.draft].filter(isDefined),
    );
    return key;
  }

  private addTransientUnits(ledger: CatalogueLedger): void {
    for (const group of transientGroups(ledger.attribution.transient)) {
      const [first] = group;
      if (!first) {
        continue;
      }
      const key =
        this.structureUnitUsingIds(group) ?? this.addTransientUnit(first);
      for (const slot of group) {
        this.ownerUnits.set(slot.key, key);
        this.own(
          key,
          slot.entries.map((entry) => entry.version),
        );
      }
    }
  }

  private structureUnitUsingIds(group: TransientSlot[]): string | undefined {
    const ids = new Set(group.flatMap(tableIdsOf));
    for (const table of this.tables.values()) {
      const { head, draft } = table.pair;
      if (
        table.structureUnit &&
        ((head && ids.has(head.id)) || (draft && ids.has(draft.id)))
      ) {
        return table.structureUnit;
      }
    }
    return undefined;
  }

  private addTransientUnit(slot: TransientSlot): string {
    return this.addUnit({
      key: `t:${slot.key}/structure`,
      kind: 'structure',
      tableCreatedId: slot.key,
      tableId: slot.tableId,
      rowCreatedIds: [],
    });
  }

  private catalogueRows(table: CatalogueTable): void {
    const { pair } = table;
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
    const isShared =
      (pair.head ?? pair.draft)?.id === SystemTables.SharedSchemas;
    const table = this.addTable(pair, 'system', {});
    if (isShared) {
      table.unitKeys = pair.changedRows.map((row) =>
        this.sharedSchemaUnit(row),
      );
    }
  }

  private sharedSchemaUnit(row: RowPair): string {
    const key = `s:${row.createdId}/sharedSchema`;
    this.addUnit({
      key,
      kind: 'sharedSchema',
      tableCreatedId: `shared:${row.createdId}`,
      tableId: (row.draft ?? row.head)?.id ?? '',
      rowCreatedIds: [row.createdId],
    });
    this.sharedRows.set(key, row);
    this.own(key, [row.head, row.draft].filter(isDefined));
    return key;
  }

  private addTable(
    pair: TablePair,
    kind: CatalogueTable['kind'],
    units: { structureUnit?: string; viewsUnit?: string },
  ): CatalogueTable {
    const table: CatalogueTable = {
      pair,
      kind,
      tableId: publicTableId(pair),
      leaves: kind === 'data' ? leavesOf(pair) : [],
      changedPointers: pair.structure?.changedPointers ?? [],
      rows: new Map(),
      unitKeys: [],
      ...units,
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

  private own(key: string, rows: RowVersion[]): void {
    this.ownedRows.set(key, [...(this.ownedRows.get(key) ?? []), ...rows]);
  }
}

type TransientSlot = LedgerAttribution['transient'][number];

function transientGroups(slots: readonly TransientSlot[]): TransientSlot[][] {
  const groups: Array<{ ids: Set<string>; slots: TransientSlot[] }> = [];
  for (const slot of slots) {
    const ids = new Set(tableIdsOf(slot));
    const joined = groups.filter((group) =>
      [...ids].some((id) => group.ids.has(id)),
    );
    const merged = {
      ids: new Set([...ids, ...joined.flatMap((group) => [...group.ids])]),
      slots: [...joined.flatMap((group) => group.slots), slot],
    };
    for (const group of joined) {
      groups.splice(groups.indexOf(group), 1);
    }
    groups.push(merged);
  }
  return groups.map((group) => group.slots);
}

function tableIdsOf(slot: TransientSlot): string[] {
  return slot.entries.flatMap(({ migration }) =>
    migration.changeType === 'rename'
      ? [migration.tableId, migration.nextTableId]
      : [migration.tableId],
  );
}

function leavesOf(pair: TablePair) {
  if (pair.structure) {
    return pair.structure.unchangedLeaves;
  }
  return pair.draftSchema ? collectSchemaLeaves(pair.draftSchema) : [];
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

function byId(rows: { head: RowVersion[]; draft: RowVersion[] }): SideRowsById {
  return {
    head: new Map(rows.head.map((row) => [row.id, row])),
    draft: new Map(rows.draft.map((row) => [row.id, row])),
  };
}

function idToCreatedId(
  index: Map<string, TablePair>,
  side: 'head' | 'draft',
): Map<string, string> {
  return new Map(
    [...index].map(([id, pair]) => [
      id,
      pair[side]?.createdId ?? pair.createdId,
    ]),
  );
}

function isDefined<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null;
}
