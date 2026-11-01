import type { Row } from 'src/engine-prisma-types';
import type {
  CatalogueRow,
  CatalogueUnit,
} from 'src/features/partial-changes/catalogue/catalogue-unit';
import {
  differingColumnsOf,
  differingLeavesOf,
} from 'src/features/partial-changes/catalogue/row-differences';
import type {
  HeadQualifier,
  RowColumn,
  Unit,
} from 'src/features/partial-changes/catalogue/unit';
import {
  fieldUnitKey,
  rowUnitKey,
  type RowUnitKind,
  structureUnitKey,
} from 'src/features/partial-changes/catalogue/unit-key';
import type { RowPair } from 'src/features/partial-changes/snapshot/changes-snapshot';
import {
  type ColumnOwner,
  columnOwnerOf,
  type LeafOwner,
  leafOwnersOf,
  type WholeColumn,
} from 'src/features/partial-changes/structure/column-owners';
import type { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';
import type { TableStructure } from 'src/features/partial-changes/structure/table-structure';

export interface ChangedTable {
  readonly identity: string;
  readonly tableId: string;
  readonly structure: TableStructure;
  readonly pairs: readonly RowPair[];
}

export interface RowUnits {
  readonly units: readonly CatalogueUnit[];
  readonly rows: readonly CatalogueRow[];
}

interface RowOnBothSides {
  readonly identity: string;
  readonly head: Row;
  readonly draft: Row;
}

type RowUnitFields = Omit<Unit, 'kind' | 'tableId'>;

const NO_SYSTEM_ROWS: readonly Row[] = [];

export function buildRowUnits(table: ChangedTable): RowUnits {
  return new RowUnitsBuilder(table).build();
}

class RowUnitsBuilder {
  private readonly units = new Map<string, CatalogueUnit>();
  private readonly headOnlyRows: ReadonlyMap<string, RowPair>;
  private readonly draftOnlyRows: ReadonlyMap<string, RowPair>;
  private readonly idsTakenByRenames: ReadonlySet<string>;
  private readonly ownedLeaves: readonly LeafOwner[];
  private readonly tableIdentities: readonly string[];

  constructor(private readonly table: ChangedTable) {
    this.tableIdentities = [table.identity];
    this.headOnlyRows = rowsById(table.pairs, headOnlyRowOf);
    this.draftOnlyRows = rowsById(table.pairs, draftOnlyRowOf);
    this.idsTakenByRenames = idsTakenByRenamesOf(table.pairs);
    this.ownedLeaves = leafOwnersOf(table.structure);
  }

  public build(): RowUnits {
    const rows = this.table.pairs.map((pair) => this.catalogueRow(pair));

    return { units: [...this.units.values()], rows };
  }

  private catalogueRow(pair: RowPair): CatalogueRow {
    const { identity, head, draft } = pair;

    if (head && draft) {
      return this.rowOnBothSides(pair, { identity, head, draft });
    }

    if (draft) {
      return existenceRow(pair, this.addCreationUnit(pair, draft));
    }

    if (head) {
      return existenceRow(pair, this.addDeletionUnit(pair, head));
    }

    throw new Error(`Row ${identity} is in neither revision`);
  }

  private addCreationUnit(pair: RowPair, draft: Row): string {
    const replaced = this.headOnlyRows.get(draft.id);

    if (replaced) {
      return this.addReplaceUnit(replaced, pair, draft.id);
    }

    return this.addRowUnit('rowCreate', [pair.identity], { rowId: draft.id });
  }

  private addDeletionUnit(pair: RowPair, head: Row): string {
    const replacement = this.draftOnlyRows.get(head.id);

    if (replacement) {
      return this.addReplaceUnit(pair, replacement, head.id);
    }

    return this.addRowUnit(
      'rowDelete',
      [pair.identity],
      { rowId: head.id },
      this.sideOfDeletedRow(head.id),
    );
  }

  private addReplaceUnit(
    deleted: RowPair,
    created: RowPair,
    rowId: string,
  ): string {
    return this.addRowUnit('rowReplace', [deleted.identity, created.identity], {
      rowId,
    });
  }

  private sideOfDeletedRow(rowId: string): HeadQualifier | undefined {
    if (this.idsTakenByRenames.has(rowId)) {
      return 'head';
    }

    return undefined;
  }

  private rowOnBothSides(pair: RowPair, row: RowOnBothSides): CatalogueRow {
    const columns = differingColumnsOf(row.head, row.draft);
    const rowColumns = this.rowColumnsAmong(columns);
    const columnOwners = new Map<WholeColumn, string>();
    const leafOwners = new Map<string, string>();

    for (const column of columns) {
      columnOwners.set(column, this.addOwnerOfColumn(row, column, rowColumns));
    }

    for (const leaf of differingLeavesOf(
      row.head,
      row.draft,
      this.ownedLeaves,
    )) {
      leafOwners.set(leaf.pointer.toString(), this.addOwnerOfLeaf(row, leaf));
    }

    return { pair, columns: columnOwners, leaves: leafOwners };
  }

  private rowColumnsAmong(columns: readonly WholeColumn[]): RowColumn[] {
    return columns.flatMap((column) => {
      if (column === 'id' || this.ownerOf(column).owner !== 'rowColumns') {
        return [];
      }

      return [column];
    });
  }

  private addOwnerOfColumn(
    row: RowOnBothSides,
    column: WholeColumn,
    rowColumns: readonly RowColumn[],
  ): string {
    const owner = this.ownerOf(column);

    switch (owner.owner) {
      case 'rowRename':
        return this.addRenameUnit(row);
      case 'field':
        return this.addFieldUnit(row, owner.pointer);
      case 'rowColumns':
        return this.addRowColumnsUnit(row, rowColumns);
      case 'structure':
        return structureUnitKey(this.table.identity);
    }
  }

  private addOwnerOfLeaf(row: RowOnBothSides, leaf: LeafOwner): string {
    if (leaf.owner === 'structure') {
      return structureUnitKey(this.table.identity);
    }

    return this.addFieldUnit(row, leaf.pointer);
  }

  private ownerOf(column: WholeColumn): ColumnOwner {
    return columnOwnerOf(column, this.table.structure);
  }

  private addRenameUnit({ identity, head, draft }: RowOnBothSides): string {
    return this.addRowUnit('rowRename', [identity], {
      rowId: draft.id,
      previousRowId: head.id,
    });
  }

  private addRowColumnsUnit(
    { identity, draft }: RowOnBothSides,
    columns: readonly RowColumn[],
  ): string {
    return this.addRowUnit('rowColumns', [identity], {
      rowId: draft.id,
      columns,
    });
  }

  private addFieldUnit(
    { identity, draft }: RowOnBothSides,
    pointer: JsonPointer,
  ): string {
    return this.addUnit(
      fieldUnitKey(this.table.identity, identity, pointer),
      [identity],
      {
        kind: 'field',
        tableId: this.table.tableId,
        rowId: draft.id,
        path: pointer.toString(),
      },
    );
  }

  private addRowUnit(
    kind: RowUnitKind,
    rowIdentities: readonly string[],
    fields: RowUnitFields,
    side?: HeadQualifier,
  ): string {
    return this.addUnit(
      rowUnitKey(kind, this.table.identity, rowIdentities),
      rowIdentities,
      { kind, tableId: this.table.tableId, ...fields },
      side,
    );
  }

  private addUnit(
    key: string,
    rowIdentities: readonly string[],
    unit: Unit,
    side?: HeadQualifier,
  ): string {
    if (!this.units.has(key)) {
      this.units.set(key, {
        key,
        tableIdentities: this.tableIdentities,
        rowIdentities,
        systemRows: NO_SYSTEM_ROWS,
        side,
        unit,
      });
    }

    return key;
  }
}

function existenceRow(pair: RowPair, existence: string): CatalogueRow {
  return { pair, existence, columns: new Map(), leaves: new Map() };
}

function rowsById(
  pairs: readonly RowPair[],
  rowOf: (pair: RowPair) => Row | undefined,
): ReadonlyMap<string, RowPair> {
  const rows = new Map<string, RowPair>();

  for (const pair of pairs) {
    const row = rowOf(pair);

    if (row) {
      rows.set(row.id, pair);
    }
  }

  return rows;
}

function headOnlyRowOf({ head, draft }: RowPair): Row | undefined {
  if (draft) {
    return undefined;
  }

  return head;
}

function draftOnlyRowOf({ head, draft }: RowPair): Row | undefined {
  if (head) {
    return undefined;
  }

  return draft;
}

function idsTakenByRenamesOf(pairs: readonly RowPair[]): ReadonlySet<string> {
  const ids = new Set<string>();

  for (const { head, draft } of pairs) {
    if (head && draft && head.id !== draft.id) {
      ids.add(draft.id);
    }
  }

  return ids;
}
