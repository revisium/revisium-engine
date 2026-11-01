import type { Migration } from '@revisium/schema-toolkit/types';
import type {
  ChangesSnapshot,
  TablePair,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import {
  type LedgerEntry,
  splitLedger,
} from 'src/features/share/ledger/migration-ledger';
import {
  type AttributedSlot,
  attributePendingLedger,
  type PendingSlotOwner,
} from 'src/features/share/ledger/pending-attribution';
import type { TableSlot } from 'src/features/share/ledger-replay/table-slots';

export interface TableHistory {
  readonly tableIds: readonly string[];
  readonly entries: readonly LedgerEntry[];
}

export interface LedgerAttribution {
  readonly published: readonly LedgerEntry[];
  readonly pending: readonly LedgerEntry[];
  readonly tables: ReadonlyMap<string, TableHistory>;
  readonly transientGroups: readonly TableHistory[];
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
  const { published, pending } = splitLedger(head, draft);

  return {
    published,
    pending,
    ...new PendingAttribution(snapshot.tables, pending).attribute(),
  };
}

export function pendingMigrationsOf(
  ledger: LedgerAttribution,
  tableIdentity: string,
): Migration[] {
  const entries = ledger.tables.get(tableIdentity)?.entries ?? [];

  return entries.map(({ migration }) => migration);
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

    for (const {
      slot,
      owner: slotOwner,
    } of this.slotsWithPendingMigrations()) {
      const owner = this.identityOwnerOf(slotOwner);

      if (owner.kind === 'table') {
        appendTo(tableSlots, owner.tableIdentity, slot);
      } else if (owner.kind === 'transient') {
        transientSlots.push(slot);
      } else {
        unattributableSlots.push(slot);
      }
    }

    return {
      tables: this.historiesByTable(tableSlots),
      transientGroups: this.groupByTableIds(transientSlots),
      unattributable: this.entriesOf(unattributableSlots),
    };
  }

  private slotsWithPendingMigrations(): AttributedSlot[] {
    const attributedSlots = attributePendingLedger(
      this.pending.map(({ migration }) => migration),
      this.headIdentities.keys(),
      this.draftIdentities,
    );

    return attributedSlots.filter(({ slot }) => slot.migrations.length > 0);
  }

  private identityOwnerOf(owner: PendingSlotOwner): SlotOwner {
    switch (owner.kind) {
      case 'headTable':
        return tableOwner(this.headIdentities.get(owner.tableId));
      case 'draftTable':
        return tableOwner(this.draftIdentities.get(owner.tableId));
      case 'transient':
        return TRANSIENT;
      case 'none':
        return NO_OWNER;
    }
  }

  private historiesByTable(
    tableSlots: ReadonlyMap<string, readonly TableSlot[]>,
  ): Map<string, TableHistory> {
    const histories = new Map<string, TableHistory>();

    for (const [tableIdentity, slots] of tableSlots) {
      histories.set(tableIdentity, this.historyOf(slots));
    }

    return histories;
  }

  private groupByTableIds(slots: readonly TableSlot[]): TableHistory[] {
    let groups: TableSlot[][] = [];

    for (const slot of slots) {
      const sharing = groups.filter((group) => sharesTableId(group, slot));
      const separate = groups.filter((group) => !sharing.includes(group));

      groups = [...separate, [...sharing.flat(), slot]];
    }

    return groups.map((group) =>
      this.historyOf(slots.filter((slot) => group.includes(slot))),
    );
  }

  private historyOf(slots: readonly TableSlot[]): TableHistory {
    return {
      tableIds: [...new Set(slots.flatMap(({ tableIds }) => tableIds))],
      entries: this.entriesOf(slots),
    };
  }

  private entriesOf(slots: readonly TableSlot[]): LedgerEntry[] {
    const migrations = new Set(slots.flatMap(({ migrations }) => migrations));

    return this.pending.filter(({ migration }) => migrations.has(migration));
  }
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
