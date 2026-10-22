import { Injectable } from '@nestjs/common';
import { getForeignKeysFromSchema } from '@revisium/schema-toolkit/lib';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type {
  Selection,
  SelectionItems,
} from 'src/features/partial-changes-poc/partial-changes.types';
import {
  isSystemPair,
  TablePair,
} from 'src/features/partial-changes-poc/snapshot/snapshot.types';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';

export type AffectedTables = ReadonlySet<string> | 'all';

export type TableScope = (tables: readonly TablePair[]) => AffectedTables;

@Injectable()
export class ReadScope {
  constructor(private readonly jsonSchemaStore: JsonSchemaStoreService) {}

  forSelection(selection: Selection): TableScope {
    if (selection.all) {
      return () => 'all';
    }
    const ids = new Set([
      ...tableIdsOf(selection),
      ...tableIdsOf(selection.exclude ?? {}),
    ]);
    return (tables) => this.connectedTables(tables, ids);
  }

  private connectedTables(
    tables: readonly TablePair[],
    selectedIds: ReadonlySet<string>,
  ): Set<string> {
    const graph = new TableGraph(
      tables.filter((pair) => !isSystemPair(pair)),
      (schema) => this.foreignKeysOf(schema),
    );
    const affected = new Set<string>();
    const queue = [...selectedIds].flatMap((id) => graph.tablesWithId(id));

    for (let pair = queue.pop(); pair; pair = queue.pop()) {
      if (!affected.has(pair.createdId)) {
        affected.add(pair.createdId);
        queue.push(...graph.neighboursOf(pair));
      }
    }

    return affected;
  }

  private foreignKeysOf(schema: JsonSchema | undefined): string[] {
    return schema
      ? getForeignKeysFromSchema(this.jsonSchemaStore.create(schema))
      : [];
  }
}

class TableGraph {
  private readonly byId = new Map<string, TablePair[]>();
  private readonly referrers = new Map<string, TablePair[]>();
  private readonly references = new Map<TablePair, string[]>();

  constructor(
    tables: readonly TablePair[],
    foreignKeysOf: (schema: JsonSchema | undefined) => string[],
  ) {
    for (const pair of tables) {
      idsOf(pair).forEach((id) => append(this.byId, id, pair));
      const references = [
        ...new Set([
          ...foreignKeysOf(pair.headSchema),
          ...foreignKeysOf(pair.draftSchema),
        ]),
      ];
      this.references.set(pair, references);
      references.forEach((id) => append(this.referrers, id, pair));
    }
  }

  tablesWithId(id: string): TablePair[] {
    return this.byId.get(id) ?? [];
  }

  neighboursOf(pair: TablePair): TablePair[] {
    return [
      ...idsOf(pair).flatMap((id) => [
        ...this.tablesWithId(id),
        ...(this.referrers.get(id) ?? []),
      ]),
      ...(this.references.get(pair) ?? []).flatMap((id) =>
        this.tablesWithId(id),
      ),
    ];
  }
}

function tableIdsOf(items: SelectionItems): string[] {
  return [
    ...(items.tables ?? []).map((selector) =>
      typeof selector === 'string' ? selector : selector.tableId,
    ),
    ...(items.tableData ?? []),
    ...(items.views ?? []),
    ...[
      ...(items.rows ?? []),
      ...(items.renames ?? []),
      ...(items.rowColumns ?? []),
      ...(items.fields ?? []),
    ].map((selector) => selector.tableId),
  ];
}

function idsOf(pair: TablePair): string[] {
  return [pair.head?.id, pair.draft?.id].filter(
    (id): id is string => id !== undefined,
  );
}

function append<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  map.set(key, [...(map.get(key) ?? []), value]);
}
