import { Injectable } from '@nestjs/common';
import type { ComparedSnapshot } from 'src/features/partial-changes/catalogue/change-catalogue';
import { TableConnections } from 'src/features/partial-changes/scope/table-connections';
import {
  type Selection,
  type SelectionItems,
  tableRefOf,
} from 'src/features/partial-changes/selection/selection';
import {
  type ComparedTable,
  hasDifferentVersions,
  type TablePair,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import { NativeSchemaRules } from 'src/features/share/ledger-replay/native-schema-rules';

export interface TableScope {
  readonly affectedTables: readonly ComparedTable[];
  readonly unreadTables: number;
}

@Injectable()
export class ReadScope {
  constructor(private readonly schemaRules: NativeSchemaRules) {}

  public scopeOf(
    selection: Selection,
    { snapshot, tables }: ComparedSnapshot,
  ): TableScope {
    const affected = this.affectedTablesOf(selection, snapshot.tables);
    const affectedTables = tables.filter(({ identity }) =>
      affected.has(identity),
    );
    const unread = tables.filter(
      (table) => hasDifferentVersions(table) && !affected.has(table.identity),
    );

    return { affectedTables, unreadTables: unread.length };
  }

  private affectedTablesOf(
    selection: Selection,
    tables: readonly TablePair[],
  ): ReadonlySet<string> {
    if (selection.all === true) {
      return new Set(tables.map(({ identity }) => identity));
    }

    const connections = new TableConnections(tables, (schema) =>
      this.schemaRules.foreignKeysOf(schema),
    );

    return connections.connectedTo(tableIdsNamedBy(selection));
  }
}

function tableIdsNamedBy(selection: Selection): string[] {
  return [selection, selection.exclude ?? {}].flatMap(tableIdsNamedIn);
}

function tableIdsNamedIn(items: SelectionItems): string[] {
  const rowSelectors = [
    ...(items.rows ?? []),
    ...(items.renames ?? []),
    ...(items.rowColumns ?? []),
    ...(items.fields ?? []),
  ];

  return [
    ...(items.tables ?? []).map((selector) => tableRefOf(selector).tableId),
    ...(items.tableData ?? []),
    ...(items.views ?? []),
    ...rowSelectors.map(({ tableId }) => tableId),
  ];
}
