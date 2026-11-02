import type { Migration } from '@revisium/schema-toolkit/types';
import { lineageIdOf } from 'src/features/share/ledger-replay/slot-check';
import { TableSlots } from 'src/features/share/ledger-replay/table-slots';

export interface TableIdChange {
  readonly migration: Migration;
  readonly lineage?: string;
}

interface LedgerTableIdChange extends TableIdChange {
  readonly position: number;
}

const HALVES = 2;

export class TableIdTimeline {
  private readonly positions = new Map<string, number>();
  private readonly changes = new Map<string, LedgerTableIdChange[]>();

  constructor(ledger: readonly Migration[]) {
    const slots = new TableSlots([]);

    ledger.forEach((migration, position) => {
      this.positions.set(migration.id, position);
      slots.follow(migration);

      for (const tableId of tableIdsNamedBy(migration)) {
        this.record(tableId, {
          migration,
          lineage: lineageHolding(slots, tableId),
          position,
        });
      }
    });
  }

  public lastChangeBefore(
    step: Migration,
    tableId: string,
  ): TableIdChange | undefined {
    const changes = this.changes.get(tableId) ?? [];

    return changes[lastIndexBefore(changes, this.positionOf(step))];
  }

  private record(tableId: string, change: LedgerTableIdChange): void {
    const changes = this.changes.get(tableId) ?? [];

    if (changes.at(-1)?.lineage === change.lineage) {
      return;
    }

    changes.push(change);
    this.changes.set(tableId, changes);
  }

  private positionOf(step: Migration): number {
    const position = this.positions.get(step.id);

    if (position === undefined) {
      throw new Error(`The ledger has no migration ${step.id}`);
    }

    return position;
  }
}

function tableIdsNamedBy(migration: Migration): string[] {
  if (migration.changeType === 'rename') {
    return [migration.tableId, migration.nextTableId];
  }

  return [migration.tableId];
}

function lineageHolding(
  slots: TableSlots,
  tableId: string,
): string | undefined {
  const slot = slots.currentSlot(tableId);

  if (!slot) {
    return undefined;
  }

  return lineageIdOf(slot);
}

function lastIndexBefore(
  changes: readonly LedgerTableIdChange[],
  position: number,
): number {
  let low = 0;
  let high = changes.length;

  while (low < high) {
    const middle = Math.floor((low + high) / HALVES);

    if (isBefore(changes[middle], position)) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low - 1;
}

function isBefore(
  change: LedgerTableIdChange | undefined,
  position: number,
): boolean {
  return change !== undefined && change.position < position;
}
