import type {
  JsonPatchReplace,
  JsonSchema,
} from '@revisium/schema-toolkit/types';
import type { NativeSchemaRules } from 'src/features/share/ledger-replay/native-schema-rules';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';
import {
  type ForeignKeySplit,
  foreignKeySplitOf,
  survivesSplit,
} from './foreign-key-split';
import type { HeadTableSchema } from './head-table-schemas';

export interface PlannedInit {
  readonly tableId: string;
  readonly schema: JsonSchema;
}

export interface PlannedUpdate {
  readonly tableId: string;
  readonly headSchema: JsonSchema;
  readonly patches: JsonPatchReplace[];
}

export interface OrderedLedger {
  readonly inits: readonly PlannedInit[];
  readonly updates: readonly PlannedUpdate[];
}

export interface UnsplittableCycles {
  readonly cycleTableIds: readonly string[];
}

interface SplitTable {
  readonly table: HeadTableSchema;
  readonly split: ForeignKeySplit;
}

export function orderedLedgerOf(
  tables: readonly HeadTableSchema[],
  rules: NativeSchemaRules,
): OrderedLedger | UnsplittableCycles {
  return new LedgerOrder(tables, rules).order();
}

class LedgerOrder {
  private readonly remaining: Map<string, HeadTableSchema>;
  private readonly inits: PlannedInit[] = [];
  private readonly updates: PlannedUpdate[] = [];

  constructor(
    tables: readonly HeadTableSchema[],
    private readonly rules: NativeSchemaRules,
  ) {
    this.remaining = new Map(
      [...tables]
        .sort((left, right) => compareCodePoints(left.tableId, right.tableId))
        .map((table) => [table.tableId, table]),
    );
  }

  public order(): OrderedLedger | UnsplittableCycles {
    while (this.remaining.size > 0) {
      const ready = this.readyTable();

      if (ready) {
        this.emitInit(ready, ready.schema);
        continue;
      }

      const splitTable = this.firstSurvivingSplit();

      if (!splitTable) {
        return { cycleTableIds: this.cycleMembers().map(tableIdOf) };
      }

      this.emitSplit(splitTable);
    }

    return {
      inits: this.inits,
      updates: [...this.updates].sort((left, right) =>
        compareCodePoints(left.tableId, right.tableId),
      ),
    };
  }

  private readyTable(): HeadTableSchema | undefined {
    return [...this.remaining.values()].find(
      (table) => this.remainingReferencesOf(table).length === 0,
    );
  }

  private firstSurvivingSplit(): SplitTable | undefined {
    for (const table of this.cycleMembers()) {
      const split = foreignKeySplitOf(
        table.schema,
        new Set(this.remainingReferencesOf(table)),
      );

      if (survivesSplit(this.rules, table.schema, split)) {
        return { table, split };
      }
    }

    return undefined;
  }

  private cycleMembers(): HeadTableSchema[] {
    return [...this.remaining.values()].filter((table) =>
      this.reachesItself(table),
    );
  }

  private reachesItself(table: HeadTableSchema): boolean {
    const visited = new Set<string>();
    const pending = this.remainingReferencesOf(table);

    for (
      let tableId = pending.pop();
      tableId !== undefined;
      tableId = pending.pop()
    ) {
      if (tableId === table.tableId) {
        return true;
      }

      if (!visited.has(tableId)) {
        visited.add(tableId);
        pending.push(
          ...this.remainingReferencesOf(this.remainingTable(tableId)),
        );
      }
    }

    return false;
  }

  private emitSplit({ table, split }: SplitTable): void {
    this.emitInit(table, split.initSchema);
    this.updates.push({
      tableId: table.tableId,
      headSchema: table.schema,
      patches: split.patches,
    });
  }

  private emitInit(table: HeadTableSchema, schema: JsonSchema): void {
    this.inits.push({ tableId: table.tableId, schema });
    this.remaining.delete(table.tableId);
  }

  private remainingReferencesOf(table: HeadTableSchema): string[] {
    return table.references.filter((target) => this.remaining.has(target));
  }

  private remainingTable(tableId: string): HeadTableSchema {
    const table = this.remaining.get(tableId);

    if (!table) {
      throw new Error(`Table "${tableId}" is not remaining`);
    }

    return table;
  }
}

function tableIdOf({ tableId }: HeadTableSchema): string {
  return tableId;
}
