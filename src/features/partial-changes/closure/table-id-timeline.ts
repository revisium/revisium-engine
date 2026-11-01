import type { Migration } from '@revisium/schema-toolkit/types';

export interface TableIdChange {
  readonly migration: Migration;
  readonly holds: boolean;
}

interface LedgerTableIdChange extends TableIdChange {
  readonly position: number;
}

export class TableIdTimeline {
  private readonly positions = new Map<string, number>();
  private readonly changes = new Map<string, LedgerTableIdChange[]>();

  constructor(ledger: readonly Migration[]) {
    ledger.forEach((migration, position) => {
      this.positions.set(migration.id, position);

      for (const [tableId, holds] of tableIdChangesOf(migration)) {
        this.record(tableId, { migration, holds, position });
      }
    });
  }

  public holdsBefore(step: Migration, tableId: string): boolean {
    return this.lastChangeBefore(step, tableId)?.holds ?? false;
  }

  public lastChangeBefore(
    step: Migration,
    tableId: string,
  ): TableIdChange | undefined {
    const position = this.positionOf(step);

    return (this.changes.get(tableId) ?? [])
      .filter((change) => change.position < position)
      .at(-1);
  }

  private record(tableId: string, change: LedgerTableIdChange): void {
    const changes = this.changes.get(tableId) ?? [];

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

function tableIdChangesOf(migration: Migration): [string, boolean][] {
  switch (migration.changeType) {
    case 'init':
      return [[migration.tableId, true]];
    case 'rename':
      return [
        [migration.tableId, false],
        [migration.nextTableId, true],
      ];
    case 'remove':
      return [[migration.tableId, false]];
    case 'update':
      return [];
  }
}
