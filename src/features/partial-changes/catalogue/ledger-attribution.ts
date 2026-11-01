import type { Migration } from '@revisium/schema-toolkit/types';
import type { Row } from 'src/engine-prisma-types';
import { compareCodePoints } from 'src/features/partial-changes/catalogue/unit-order';
import type {
  ChangesSnapshot,
  TablePair,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import {
  type TableSlot,
  traceTableSlots,
} from 'src/features/share/ledger-replay/table-slots';

export interface LedgerEntry {
  readonly row: Row;
  readonly migration: Migration;
}

export interface TransientGroup {
  readonly tableIds: readonly string[];
  readonly entries: readonly LedgerEntry[];
}

export interface LedgerAttribution {
  readonly published: readonly LedgerEntry[];
  readonly pending: readonly LedgerEntry[];
  readonly tables: ReadonlyMap<string, readonly LedgerEntry[]>;
  readonly transientGroups: readonly TransientGroup[];
  readonly unattributable: readonly LedgerEntry[];
}

type SlotOwner =
  | { readonly kind: 'table'; readonly tableIdentity: string }
  | { readonly kind: 'transient' }
  | { readonly kind: 'none' };

const TRANSIENT: SlotOwner = { kind: 'transient' };
const NO_OWNER: SlotOwner = { kind: 'none' };

export function attributeLedger(snapshot: ChangesSnapshot): LedgerAttribution {
  const { head, draft } = snapshot.systemRows.migrations;
  const publishedVersionIds = new Set(head.map(({ versionId }) => versionId));
  const pending = ledgerOf(
    draft.filter(({ versionId }) => !publishedVersionIds.has(versionId)),
  );

  return {
    published: ledgerOf(head),
    pending,
    ...new PendingAttribution(snapshot.tables, pending).attribute(),
  };
}

export function pendingMigrationsOf(
  ledger: LedgerAttribution,
  tableIdentity: string,
): Migration[] {
  return (ledger.tables.get(tableIdentity) ?? []).map(
    ({ migration }) => migration,
  );
}

class PendingAttribution {
  private readonly headIdentities: ReadonlyMap<string, string>;
  private readonly draftIdentities: ReadonlyMap<string, string>;

  constructor(
    tables: readonly TablePair[],
    private readonly pending: readonly LedgerEntry[],
  ) {
    this.headIdentities = identitiesByTableId(tables, 'head');
    this.draftIdentities = identitiesByTableId(tables, 'draft');
  }

  public attribute(): Omit<LedgerAttribution, 'published' | 'pending'> {
    const tableSlots = new Map<string, TableSlot[]>();
    const transientSlots: TableSlot[] = [];
    const unattributableSlots: TableSlot[] = [];

    for (const slot of this.slotsWithPendingMigrations()) {
      const owner = this.ownerOf(slot);

      if (owner.kind === 'table') {
        appendTo(tableSlots, owner.tableIdentity, slot);
      } else if (owner.kind === 'transient') {
        transientSlots.push(slot);
      } else {
        unattributableSlots.push(slot);
      }
    }

    return {
      tables: this.entriesByTable(tableSlots),
      transientGroups: this.groupByTableIds(transientSlots),
      unattributable: this.entriesOf(unattributableSlots),
    };
  }

  private slotsWithPendingMigrations(): TableSlot[] {
    const slots = traceTableSlots(
      this.pending.map(({ migration }) => migration),
      this.headIdentities.keys(),
    );

    return slots.filter(({ migrations }) => migrations.length > 0);
  }

  private ownerOf(slot: TableSlot): SlotOwner {
    if (slot.brokenBy) {
      return NO_OWNER;
    }

    if (slot.startingTableId !== undefined) {
      return tableOwner(this.headIdentities.get(slot.startingTableId));
    }

    if (slot.currentTableId === undefined) {
      return TRANSIENT;
    }

    return tableOwner(this.draftIdentities.get(slot.currentTableId));
  }

  private entriesByTable(
    tableSlots: ReadonlyMap<string, readonly TableSlot[]>,
  ): Map<string, LedgerEntry[]> {
    const entries = new Map<string, LedgerEntry[]>();

    for (const [tableIdentity, slots] of tableSlots) {
      entries.set(tableIdentity, this.entriesOf(slots));
    }

    return entries;
  }

  private groupByTableIds(slots: readonly TableSlot[]): TransientGroup[] {
    let groups: TableSlot[][] = [];

    for (const slot of slots) {
      const sharing = groups.filter((group) => sharesTableId(group, slot));
      const separate = groups.filter((group) => !sharing.includes(group));

      groups = [...separate, [...sharing.flat(), slot]];
    }

    return groups.map((group) => {
      const ordered = slots.filter((slot) => group.includes(slot));

      return {
        tableIds: [...new Set(ordered.flatMap(({ tableIds }) => tableIds))],
        entries: this.entriesOf(ordered),
      };
    });
  }

  private entriesOf(slots: readonly TableSlot[]): LedgerEntry[] {
    const migrations = new Set(slots.flatMap(({ migrations }) => migrations));

    return this.pending.filter(({ migration }) => migrations.has(migration));
  }
}

function ledgerOf(rows: readonly Row[]): LedgerEntry[] {
  return [...rows]
    .sort((left, right) => compareCodePoints(left.id, right.id))
    .map((row) => ({ row, migration: row.data as unknown as Migration }));
}

function identitiesByTableId(
  tables: readonly TablePair[],
  side: 'head' | 'draft',
): ReadonlyMap<string, string> {
  const identities = new Map<string, string>();

  for (const pair of tables) {
    const version = pair[side];

    if (version) {
      identities.set(version.id, pair.identity);
    }
  }

  return identities;
}

function tableOwner(tableIdentity: string | undefined): SlotOwner {
  if (tableIdentity === undefined) {
    return NO_OWNER;
  }

  return { kind: 'table', tableIdentity };
}

function appendTo(
  slotsByTable: Map<string, TableSlot[]>,
  tableIdentity: string,
  slot: TableSlot,
): void {
  slotsByTable.set(tableIdentity, [
    ...(slotsByTable.get(tableIdentity) ?? []),
    slot,
  ]);
}

function sharesTableId(group: readonly TableSlot[], slot: TableSlot): boolean {
  return group.some(({ tableIds }) =>
    tableIds.some((tableId) => slot.tableIds.includes(tableId)),
  );
}
