import type { JsonSchema } from '@revisium/schema-toolkit/types';
import {
  outcomeId,
  TargetRow,
  TargetState,
  TargetTable,
  targetTableVersion,
} from 'src/features/partial-changes-poc/assembly/target.types';
import { CatalogueRow } from 'src/features/partial-changes-poc/catalogue/change-catalogue.types';
import {
  sideOf,
  TableVersion,
} from 'src/features/partial-changes-poc/snapshot/snapshot.types';

export interface IndexedTable {
  target: TargetTable;
  publicId: string;
  version: TableVersion;
  schema?: JsonSchema;
  resultIds: Map<string, TargetRow[]>;
  touchedIds: Set<string>;
  otherIds: Map<string, CatalogueRow>;
  removedIds: string[];
}

export class TargetIndex {
  readonly tables: IndexedTable[] = [];
  private readonly byPublicId = new Map<string, IndexedTable>();

  constructor(readonly state: TargetState) {
    for (const target of state.tables) {
      const indexed = this.indexTable(target);
      if (indexed) {
        this.tables.push(indexed);
        this.byPublicId.set(indexed.publicId, indexed);
      }
    }
  }

  table(publicId: string): IndexedTable | undefined {
    return this.byPublicId.get(publicId);
  }

  private indexTable(target: TargetTable): IndexedTable | undefined {
    const { direction } = this.state;
    const version = targetTableVersion(target, direction);
    if (!version || version.system) {
      return undefined;
    }

    const side = target.outcome === 'other' ? direction.other : direction.base;
    const pair = target.table.pair;
    const indexed: IndexedTable = {
      target,
      publicId: version.id,
      version,
      schema: side === 'head' ? pair.headSchema : pair.draftSchema,
      resultIds: new Map(),
      touchedIds: new Set(),
      otherIds: new Map(),
      removedIds: [],
    };

    for (const targetRow of target.rows) {
      this.indexRow(indexed, targetRow);
    }

    indexed.removedIds = this.removedIds(indexed);
    return indexed;
  }

  private indexRow(indexed: IndexedTable, targetRow: TargetRow): void {
    const { direction } = this.state;
    const { pair } = targetRow.row;
    const base = sideOf(pair, direction.base);
    const other = sideOf(pair, direction.other);
    const id = outcomeId(targetRow.outcome);

    if (id !== undefined) {
      const rows = indexed.resultIds.get(id) ?? [];
      rows.push(targetRow);
      indexed.resultIds.set(id, rows);
    }

    for (const version of [base, other]) {
      if (version) {
        indexed.touchedIds.add(version.id);
      }
    }

    if (other) {
      indexed.otherIds.set(other.id, targetRow.row);
    }
  }

  private removedIds(indexed: IndexedTable): string[] {
    const { direction } = this.state;
    return indexed.target.rows
      .map(({ row }) => sideOf(row.pair, direction.base)?.id)
      .filter(
        (id): id is string => id !== undefined && !indexed.resultIds.has(id),
      );
  }
}
