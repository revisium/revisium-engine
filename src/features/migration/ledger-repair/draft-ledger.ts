import {
  hasIntactPublishedPrefix,
  type LedgerEntry,
  migrationsOf,
  splitLedger,
  storesMigrationsUnderTheirIds,
} from 'src/features/share/ledger/migration-ledger';
import {
  type AttributedSlot,
  attributePendingLedger,
} from 'src/features/share/ledger/pending-attribution';
import { pendingSchemaHistory } from 'src/features/share/ledger/schema-history';
import type { ReplayedLedger } from 'src/features/share/ledger-replay/ledger-replay';
import { schemasEqual } from 'src/features/share/ledger-replay/schemas-equal';
import type { HistoryPatches } from 'src/features/share/queries/impl';
import type { RepairState } from './repair-state-reader';

export interface TableHistories {
  readonly draftTableId: string;
  readonly inherited: readonly HistoryPatches[];
  readonly pending: readonly HistoryPatches[];
}

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
      migrationsOf(pending),
      state.head.tableVersionIds.keys(),
      state.draft.tableVersionIds,
    );
  }

  public isConsistent(): boolean {
    return (
      storesMigrationsUnderTheirIds(this.state.head.migrationRows) &&
      storesMigrationsUnderTheirIds(this.state.draft.migrationRows) &&
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

  public historiesOf(headTableId: string): TableHistories | undefined {
    const draftTableId = this.draftTableIdOf(headTableId);

    if (draftTableId === undefined) {
      return undefined;
    }

    return this.historiesBetween(headTableId, draftTableId);
  }

  private continuesHeadHistory({ slot, owner }: AttributedSlot): boolean {
    if (owner.kind !== 'headTable' || slot.currentTableId === undefined) {
      return true;
    }

    return (
      this.historiesBetween(owner.tableId, slot.currentTableId) !== undefined
    );
  }

  private historiesBetween(
    headTableId: string,
    draftTableId: string,
  ): TableHistories | undefined {
    const inherited = this.state.head.schemas.get(headTableId)?.history ?? [];
    const draftHistory =
      this.state.draft.schemas.get(draftTableId)?.history ?? inherited;
    const pending = pendingSchemaHistory(inherited, draftHistory);

    if (!pending.extendsHead) {
      return undefined;
    }

    return { draftTableId, inherited, pending: pending.entries };
  }
}
