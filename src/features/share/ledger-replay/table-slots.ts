import type {
  InitMigration,
  Migration,
  RemoveMigration,
  RenameMigration,
} from '@revisium/schema-toolkit/types';

export interface TableSlot {
  readonly startingTableId?: string;
  readonly tableIds: readonly string[];
  readonly migrations: readonly Migration[];
  readonly currentTableId?: string;
  readonly brokenBy?: Migration;
}

export interface SlotStep {
  readonly slot: TableSlot;
  readonly displaced?: TableSlot;
  readonly attributable: boolean;
}

interface OpenableSlot {
  startingTableId?: string;
  tableIds: string[];
  migrations: Migration[];
  currentTableId?: string;
  brokenBy?: Migration;
}

interface SlotAttribution {
  slot: OpenableSlot;
  attributable: boolean;
}

export function traceTableSlots(
  ledger: readonly Migration[],
  startingTableIds: Iterable<string> = [],
): readonly TableSlot[] {
  const slots = new TableSlots(startingTableIds);

  for (const migration of ledger) {
    slots.follow(migration);
  }

  return slots.all();
}

export function isLedgered(
  slots: readonly TableSlot[],
  tableId: string,
): boolean {
  return slots.some((slot) => ledgeredTableIdOf(slot) === tableId);
}

export function ledgeredTableIdOf(slot: TableSlot): string | undefined {
  if (slot.brokenBy) {
    return undefined;
  }

  return slot.currentTableId;
}

export class TableSlots {
  private readonly slots: OpenableSlot[] = [];
  private readonly current = new Map<string, OpenableSlot>();

  constructor(startingTableIds: Iterable<string>) {
    for (const tableId of startingTableIds) {
      this.place(this.newSlot({ startingTableId: tableId }), tableId);
    }
  }

  public all(): readonly TableSlot[] {
    return [...this.slots];
  }

  public currentSlot(tableId: string): TableSlot | undefined {
    return this.current.get(tableId);
  }

  public currentSlots(): ReadonlyMap<string, TableSlot> {
    return this.current;
  }

  public follow(migration: Migration): SlotStep {
    switch (migration.changeType) {
      case 'init':
        return this.openSlot(migration);
      case 'update':
        return this.appendToSlot(migration);
      case 'rename':
        return this.moveSlot(migration);
      case 'remove':
        return this.closeSlot(migration);
    }
  }

  private openSlot(migration: InitMigration): SlotStep {
    const slot = this.newSlot({ migrations: [migration] });
    const displaced = this.occupy(slot, migration.tableId, migration);

    return { slot, displaced, attributable: true };
  }

  private moveSlot(migration: RenameMigration): SlotStep {
    const step = this.appendToSlot(migration);
    const displaced = this.occupy(step.slot, migration.nextTableId, migration);

    return { ...step, displaced };
  }

  private closeSlot(migration: RemoveMigration): SlotStep {
    const step = this.appendToSlot(migration);
    this.vacate(step.slot);

    return step;
  }

  private appendToSlot(migration: Migration): SlotAttribution {
    const slot = this.current.get(migration.tableId);

    if (slot) {
      slot.migrations.push(migration);
      return { slot, attributable: true };
    }

    return { slot: this.openBrokenSlot(migration), attributable: false };
  }

  private openBrokenSlot(migration: Migration): OpenableSlot {
    const slot = this.newSlot({ migrations: [migration], brokenBy: migration });
    this.place(slot, migration.tableId);

    return slot;
  }

  private occupy(
    slot: OpenableSlot,
    tableId: string,
    migration: Migration,
  ): OpenableSlot | undefined {
    const displaced = this.current.get(tableId);
    this.vacate(slot);

    if (displaced) {
      this.vacate(displaced);
      breakLineage(displaced, migration);
      breakLineage(slot, migration);
    }

    this.place(slot, tableId);
    return displaced;
  }

  private place(slot: OpenableSlot, tableId: string): void {
    this.current.set(tableId, slot);
    slot.currentTableId = tableId;
    slot.tableIds.push(tableId);
  }

  private vacate(slot: OpenableSlot): void {
    if (slot.currentTableId !== undefined) {
      this.current.delete(slot.currentTableId);
      slot.currentTableId = undefined;
    }
  }

  private newSlot(fields: Partial<OpenableSlot>): OpenableSlot {
    const slot: OpenableSlot = { tableIds: [], migrations: [], ...fields };
    this.slots.push(slot);

    return slot;
  }
}

function breakLineage(slot: OpenableSlot, migration: Migration): void {
  if (!slot.brokenBy) {
    slot.brokenBy = migration;
  }
}
