import { Injectable } from '@nestjs/common';
import type { SchemaLedgerRepairPlan } from 'src/features/migration/queries/impl/plan-schema-ledger-repair.query';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import type { ReplayedLedger } from 'src/features/share/ledger-replay/ledger-replay';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';
import { DraftLedger } from './draft-ledger';
import { storedLedgerReplayOf } from './repair-ledger';
import { repairedTablesOf } from './repair-planning';
import {
  type RepairBranch,
  type RepairState,
  RepairStateReader,
} from './repair-state-reader';

@Injectable()
export class StoredLedgerVerification {
  constructor(
    private readonly stateReader: RepairStateReader,
    private readonly schemaStore: JsonSchemaStoreService,
    private readonly validator: JsonSchemaValidatorService,
  ) {}

  public async verify(
    branch: RepairBranch,
    plan: SchemaLedgerRepairPlan,
  ): Promise<void> {
    const defect = this.defectOf(
      await this.stateReader.readBranch(branch),
      repairedTablesOf(plan).map(({ tableId }) => tableId),
    );

    if (defect !== undefined) {
      throw new Error(`The repaired Draft ledger ${defect}`);
    }
  }

  private defectOf(
    state: RepairState,
    repairedTableIds: readonly string[],
  ): string | undefined {
    const ledger = new DraftLedger(state);

    if (!ledger.isConsistent()) {
      return 'does not continue the Head ledger and schema histories';
    }

    if (!hasIncreasingIds(ledger)) {
      return 'does not number its pending migrations after the published ones';
    }

    const replay = storedLedgerReplayOf(state.draft, {
      refs: this.schemaStore.refs,
      validator: this.validator,
    });
    const unreproduced = repairedTableIds.find(
      (tableId) => !reproducesDraftSchema(ledger, replay, tableId),
    );

    if (unreproduced !== undefined) {
      return `does not reproduce the Draft schema of ${unreproduced}`;
    }

    return undefined;
  }
}

function hasIncreasingIds({ published, pending }: DraftLedger): boolean {
  const ids = [...published, ...pending].map(({ migration }) => migration.id);
  const increasingIds = [...new Set(ids)].sort(compareCodePoints);

  return ids.every((id, index) => id === increasingIds[index]);
}

function reproducesDraftSchema(
  ledger: DraftLedger,
  replay: ReplayedLedger,
  headTableId: string,
): boolean {
  const draftTableId = ledger.draftTableIdOf(headTableId);

  return (
    draftTableId !== undefined &&
    ledger.reproducesDraftSchema(replay, draftTableId)
  );
}
