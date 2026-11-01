import { Injectable } from '@nestjs/common';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import type { ReplayedLedger } from 'src/features/share/ledger-replay/ledger-replay';
import { LedgerReplayer } from 'src/features/share/ledger-replay/ledger-replayer';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';
import { DraftLedger } from './draft-ledger';
import { storedLedgerReplayOf } from './repair-ledger';
import { isNativeHistory } from './repair-patch';
import { type PlannedRepair, repairedTablesOf } from './repair-planning';
import {
  type RepairBranch,
  type RepairState,
  RepairStateReader,
} from './repair-state-reader';

@Injectable()
export class StoredLedgerVerification {
  constructor(
    private readonly stateReader: RepairStateReader,
    private readonly replayer: LedgerReplayer,
    private readonly validator: JsonSchemaValidatorService,
  ) {}

  public async verify(
    branch: RepairBranch,
    planned: PlannedRepair,
  ): Promise<void> {
    const defect = this.defectOf(
      await this.stateReader.readBranch(branch),
      planned,
    );

    if (defect !== undefined) {
      throw new Error(`The repaired Draft ledger ${defect}`);
    }
  }

  private defectOf(
    stored: RepairState,
    planned: PlannedRepair,
  ): string | undefined {
    const ledger = new DraftLedger(stored);

    if (!ledger.isConsistent()) {
      return 'does not continue the Head ledger and schema histories';
    }

    if (!hasIncreasingIds(ledger)) {
      return 'does not number its pending migrations after the published ones';
    }

    const refused = repairedTablesOf(planned.plan).find(
      ({ tableId }) => !this.storesNativeHistory(ledger, tableId),
    );

    if (refused !== undefined) {
      return `stores a schema history of ${refused.tableId} that native writes refuse`;
    }

    const replay = this.replayOf(stored);
    const unreproduced = this.draftTableIdsToReproduce(planned).find(
      (draftTableId) => !ledger.reproducesDraftSchema(replay, draftTableId),
    );

    if (unreproduced !== undefined) {
      return `does not reproduce the Draft schema of ${unreproduced}`;
    }

    return undefined;
  }

  private draftTableIdsToReproduce({ state, plan }: PlannedRepair): string[] {
    const ledger = new DraftLedger(state);
    const replay = this.replayOf(state);
    const reproduced = [...state.draft.tableVersionIds.keys()].filter(
      (draftTableId) => ledger.reproducesDraftSchema(replay, draftTableId),
    );
    const repaired = repairedTablesOf(plan).map(
      ({ tableId }) => ledger.draftTableIdOf(tableId) ?? tableId,
    );

    return [...new Set([...reproduced, ...repaired])];
  }

  private storesNativeHistory(ledger: DraftLedger, tableId: string): boolean {
    const histories = ledger.historiesOf(tableId);

    return (
      histories !== undefined &&
      isNativeHistory(
        [...histories.inherited, ...histories.pending],
        this.validator,
      )
    );
  }

  private replayOf(state: RepairState): ReplayedLedger {
    return storedLedgerReplayOf(state.draft, this.replayer);
  }
}

function hasIncreasingIds({ published, pending }: DraftLedger): boolean {
  const ids = [...published, ...pending].map(({ migration }) => migration.id);
  const increasingIds = [...new Set(ids)].sort(compareCodePoints);

  return ids.every((id, index) => id === increasingIds[index]);
}
