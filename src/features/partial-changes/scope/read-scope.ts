import { Injectable } from '@nestjs/common';
import type { JsonSchema, Migration } from '@revisium/schema-toolkit/types';
import { publicIdsOf } from 'src/features/partial-changes/catalogue/public-id-groups';
import {
  type ConnectedTable,
  TableConnections,
} from 'src/features/partial-changes/scope/table-connections';
import {
  type Selection,
  type SelectionItems,
  tableRefOf,
} from 'src/features/partial-changes/selection/selection';
import {
  type ComparedTable,
  hasDifferentVersions,
  type TablePair,
  type TableVersion,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { ComparedSnapshot } from 'src/features/partial-changes/snapshot/compared-snapshot-reader.service';
import type { TableHistory } from 'src/features/partial-changes/snapshot/ledger-attribution';
import {
  NativeSchemaRules,
  patchValues,
} from 'src/features/share/ledger-replay/native-schema-rules';

export interface TableScope {
  readonly affectedTables: readonly ComparedTable[];
  readonly unreadTables: number;
}

const NO_HISTORY: TableHistory = { tableIds: [], entries: [] };

@Injectable()
export class ReadScope {
  constructor(private readonly schemaRules: NativeSchemaRules) {}

  public scopeOf(selection: Selection, compared: ComparedSnapshot): TableScope {
    const { tables } = compared;
    const affected = this.affectedTablesOf(selection, compared);
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
    { snapshot, ledger }: ComparedSnapshot,
  ): ReadonlySet<string> {
    if (selection.all === true) {
      return new Set(snapshot.tables.map(({ identity }) => identity));
    }

    const connections = new TableConnections([
      ...snapshot.tables.map((pair) =>
        this.connectedTableOf(
          pair,
          ledger.tables.get(pair.identity) ?? NO_HISTORY,
        ),
      ),
      ...ledger.transientGroups.map((group) => this.connectedHistoryOf(group)),
    ]);

    return connections.connectedTo(tableIdsNamedBy(selection));
  }

  private connectedTableOf(
    pair: TablePair,
    history: TableHistory,
  ): ConnectedTable {
    const { tableIds, referencedTableIds } = this.connectedHistoryOf(history);

    return {
      identity: pair.identity,
      tableIds: [...publicIdsOf(pair), ...tableIds],
      referencedTableIds: [
        ...versionsOf(pair).flatMap(({ schema }) =>
          this.schemaRules.foreignKeysOf(schema),
        ),
        ...referencedTableIds,
      ],
    };
  }

  private connectedHistoryOf({
    tableIds,
    entries,
  }: TableHistory): ConnectedTable {
    return {
      tableIds,
      referencedTableIds: entries
        .flatMap(({ migration }) => schemasNamedBy(migration))
        .flatMap((schema) => this.schemaRules.foreignKeysOf(schema)),
    };
  }
}

function schemasNamedBy(migration: Migration): JsonSchema[] {
  switch (migration.changeType) {
    case 'init':
      return [migration.schema];
    case 'update':
      return patchValues(migration.patches);
    case 'rename':
    case 'remove':
      return [];
  }
}

function versionsOf({ head, draft }: TablePair): TableVersion[] {
  return [head, draft].filter(
    (version): version is TableVersion => version !== undefined,
  );
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
