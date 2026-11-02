import type { AddressedRow } from 'src/features/partial-changes/catalogue/catalogue-lookup';
import { groupRecreations } from 'src/features/partial-changes/catalogue/public-id-groups';
import { PublicIdIndex } from 'src/features/partial-changes/catalogue/public-id-index';
import type { HeadQualifier } from 'src/features/partial-changes/catalogue/unit';
import type { RefusedTable } from 'src/features/partial-changes/head-schema/head-schema-check';
import { tablesOfRow } from 'src/features/partial-changes/selection/addressed-rows';
import type { RowRef } from 'src/features/partial-changes/selection/selection';
import type { SelectionSource } from 'src/features/partial-changes/selection/selection-resolution';
import type {
  TablePair,
  TableVersion,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';
import {
  type SchemaLeaf,
  SchemaLeaves,
} from 'src/features/partial-changes/structure/schema-leaves';
import type { TableStructure } from 'src/features/partial-changes/structure/table-structure';

export class SelectionTargets {
  private readonly tables: PublicIdIndex<TablePair>;
  private readonly recreations = new Map<string, readonly TablePair[]>();
  private readonly leaves = new Map<string, SchemaLeaves>();

  constructor(private readonly source: SelectionSource) {
    this.tables = new PublicIdIndex(source.snapshot.tables, (pair) => pair);

    for (const group of groupRecreations(source.snapshot.tables)) {
      for (const { identity } of group) {
        this.recreations.set(identity, group);
      }
    }
  }

  public tableNamed(
    tableId: string,
    side?: HeadQualifier,
  ): TablePair | undefined {
    return this.tables.resolve(tableId, side);
  }

  public tableOfRow({ tableId, rowId, side }: RowRef): TablePair | undefined {
    const tables = tablesOfRow(this.tables, tableId, side);

    return tables.find((table) => this.holds(table, rowId, side)) ?? tables[0];
  }

  public rowNamed(
    table: TablePair,
    rowId: string,
    side?: HeadQualifier,
  ): AddressedRow | undefined {
    const rowSide = this.source.addressedRows.sideOf(table, rowId, side);

    if (rowSide === undefined) {
      return undefined;
    }

    return { table, rowId, side: rowSide };
  }

  public refusalsOfTable({ identity }: TablePair): RefusedTable[] {
    const refused =
      this.source.headSchema.refusedTablesByIdentity.get(identity);

    return refused ? [refused] : [];
  }

  public refusalsOfStructure(table: TablePair): RefusedTable[] {
    return (this.recreations.get(table.identity) ?? [table]).flatMap((member) =>
      this.refusalsOfTable(member),
    );
  }

  public structureOf(table: TablePair): TableStructure {
    return this.source.catalogue.tables.structureOf(table);
  }

  public leafAtOrAbove(
    row: AddressedRow,
    path: JsonPointer,
  ): SchemaLeaf | undefined {
    return this.leavesOf(versionOn(row)).all.find(({ pointer }) =>
      pointer.isAtOrAbove(path),
    );
  }

  private holds(
    table: TablePair,
    rowId: string,
    side?: HeadQualifier,
  ): boolean {
    return this.source.addressedRows.sideOf(table, rowId, side) !== undefined;
  }

  private leavesOf({ versionId, schema }: TableVersion): SchemaLeaves {
    const cached = this.leaves.get(versionId);

    if (cached) {
      return cached;
    }

    const leaves = SchemaLeaves.of(schema);

    this.leaves.set(versionId, leaves);

    return leaves;
  }
}

function versionOn({ table, side }: AddressedRow): TableVersion {
  const version = table[side];

  if (!version) {
    throw new Error(`Table ${table.identity} has no ${side} version`);
  }

  return version;
}
