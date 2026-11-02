import type { Migration } from '@revisium/schema-toolkit/types';
import type { RevisionSide } from 'src/features/draft-revision/commands/impl/target-write-plan';
import type { ChangesSnapshot } from 'src/features/partial-changes/snapshot/changes-snapshot';
import {
  ledgerOf,
  migrationsOf,
} from 'src/features/share/ledger/migration-ledger';
import type { ReplayedLedger } from 'src/features/share/ledger-replay/ledger-replay';
import type { LedgerReplayer } from 'src/features/share/ledger-replay/ledger-replayer';
import {
  type TableSlot,
  traceTableSlots,
} from 'src/features/share/ledger-replay/table-slots';

export class SourceReplays {
  private readonly replays = new Map<RevisionSide, ReplayedLedger>();
  private tracedDraftSlots?: readonly TableSlot[];

  constructor(
    private readonly snapshot: ChangesSnapshot,
    private readonly replayer: LedgerReplayer,
  ) {}

  public get head(): ReplayedLedger {
    return this.replayOf('head');
  }

  public get draft(): ReplayedLedger {
    return this.replayOf('draft');
  }

  public get draftSlots(): readonly TableSlot[] {
    this.tracedDraftSlots ??= traceTableSlots(
      sourceLedgerOf(this.snapshot, 'draft'),
    );

    return this.tracedDraftSlots;
  }

  private replayOf(side: RevisionSide): ReplayedLedger {
    let replay = this.replays.get(side);

    if (!replay) {
      replay = this.replayer.replay(sourceLedgerOf(this.snapshot, side));
      this.replays.set(side, replay);
    }

    return replay;
  }
}

export function sourceLedgerOf(
  { systemRows }: ChangesSnapshot,
  side: RevisionSide,
): Migration[] {
  return migrationsOf(ledgerOf(systemRows.migrations[side]));
}
