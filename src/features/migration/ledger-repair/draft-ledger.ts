import {
  hasIntactPublishedPrefix,
  type LedgerEntry,
  splitLedger,
} from 'src/features/share/ledger/migration-ledger';
import {
  type AttributedSlot,
  attributePendingLedger,
} from 'src/features/share/ledger/pending-attribution';
import { pendingSchemaHistory } from 'src/features/share/ledger/schema-history';
import type { ReplayedLedger } from 'src/features/share/ledger-replay/ledger-replay';
import { schemasEqual } from 'src/features/share/ledger-replay/schemas-equal';
import type { RepairState } from './repair-state-reader';

export class DraftLedger {
  public readonly published: readonly LedgerEntry[];
  public readonly pending: readonly LedgerEntry[];
  private readonly attributedSlots: readonly AttributedSlot[];

  constructor(private readonly state: RepairState) {
    const { published, pending } = splitLedger(
      state.head.migrationRows,
      state.draft.migrationRows,
    );
    this.published = published;
    this.pending = pending;
    this.attributedSlots = attributePendingLedger(
      pending.map(({ migration }) => migration),
      state.head.tableVersionIds.keys(),
      state.draft.tableVersionIds,
    );
  }

  public isConsistent(): boolean {
    return (
      hasIntactPublishedPrefix(
        this.state.head.migrationRows,
        this.state.draft.migrationRows,
      ) &&
      this.attributedSlots.every(
        (attributed) =>
          attributed.owner.kind !== 'none' &&
          this.continuesHeadHistory(attributed),
      )
    );
  }

  public draftTableIdOf(headTableId: string): string | undefined {
    const attributed = this.attributedSlots.find(
      ({ slot }) => slot.startingTableId === headTableId,
    );

    return attributed?.slot.currentTableId;
  }

  public reproducesDraftSchema(
    replay: ReplayedLedger,
    draftTableId: string,
  ): boolean {
    const replayed = replay.schemas.get(draftTableId);
    const stored = this.state.draft.schemas.get(draftTableId);

    return (
      replayed !== undefined &&
      stored !== undefined &&
      schemasEqual(replayed, stored.schema)
    );
  }

  private continuesHeadHistory({ slot, owner }: AttributedSlot): boolean {
    if (owner.kind !== 'headTable' || slot.currentTableId === undefined) {
      return true;
    }

    const headHistory =
      this.state.head.schemas.get(owner.tableId)?.history ?? [];
    const draftHistory =
      this.state.draft.schemas.get(slot.currentTableId)?.history ?? headHistory;

    return pendingSchemaHistory(headHistory, draftHistory).extendsHead;
  }
}
