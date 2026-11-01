import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { DraftWriteAdmissionService } from 'src/features/draft/draft-write-admission.service';
import {
  RepairSchemaLedgerCommand,
  type RepairSchemaLedgerData,
  type SchemaLedgerRepair,
} from 'src/features/migration/commands/impl/repair-schema-ledger.command';
import { RepairFreshness } from 'src/features/migration/ledger-repair/repair-freshness';
import {
  type PlannedRepair,
  repairedTablesOf,
  RepairPlanning,
} from 'src/features/migration/ledger-repair/repair-planning';
import { RepairStateReader } from 'src/features/migration/ledger-repair/repair-state-reader';
import { RepairWriter } from 'src/features/migration/ledger-repair/repair-writer';
import { StoredLedgerVerification } from 'src/features/migration/ledger-repair/stored-ledger-verification';
import type { SchemaLedgerRepairPlan } from 'src/features/migration/queries/impl/plan-schema-ledger-repair.query';
import { ShareCommands } from 'src/features/share/share.commands';
import { OperationTransactionRunner } from 'src/infrastructure/database/operation-transaction-runner';

@CommandHandler(RepairSchemaLedgerCommand)
export class RepairSchemaLedgerHandler implements ICommandHandler<
  RepairSchemaLedgerCommand,
  SchemaLedgerRepair
> {
  constructor(
    private readonly transactionRunner: OperationTransactionRunner,
    private readonly stateReader: RepairStateReader,
    private readonly repairPlanning: RepairPlanning,
    private readonly writeAdmission: DraftWriteAdmissionService,
    private readonly freshness: RepairFreshness,
    private readonly writer: RepairWriter,
    private readonly verification: StoredLedgerVerification,
    private readonly shareCommands: ShareCommands,
  ) {}

  public async execute({
    data,
  }: RepairSchemaLedgerCommand): Promise<SchemaLedgerRepair> {
    const planned = await this.transactionRunner.runPlanning(() =>
      this.planRepair(data),
    );
    const dryRun = data.dryRun ?? false;

    if (dryRun || repairedTablesOf(planned.plan).length === 0) {
      return repairResultOf(planned.plan, dryRun);
    }

    return this.writeRepair(data, planned);
  }

  private async planRepair(
    data: RepairSchemaLedgerData,
  ): Promise<PlannedRepair> {
    const state = await this.stateReader.readUnlockedBranch(data);

    return {
      state,
      plan: await this.repairPlanning.plan(state, { tableIds: data.tableIds }),
    };
  }

  private async writeRepair(
    data: RepairSchemaLedgerData,
    planned: PlannedRepair,
  ): Promise<SchemaLedgerRepair> {
    const { draftRevisionId } = planned.state;
    const written = await this.writeAdmission.runSerializableRevisionWrite(
      draftRevisionId,
      () => this.recordFreshRepair(data, planned),
    );

    if (!written) {
      return staleRepairOf(planned.plan);
    }

    await this.shareCommands.notifyEndpoints({ revisionId: draftRevisionId });

    return repairResultOf(planned.plan, false);
  }

  private async recordFreshRepair(
    data: RepairSchemaLedgerData,
    planned: PlannedRepair,
  ): Promise<boolean> {
    if (!(await this.freshness.isFresh(data, planned))) {
      return false;
    }

    await this.writer.record(planned);
    await this.verification.verify(data, planned.plan);

    return true;
  }
}

function repairResultOf(
  plan: SchemaLedgerRepairPlan,
  dryRun: boolean,
): SchemaLedgerRepair {
  return {
    headRevisionId: plan.headRevisionId,
    draftRevisionId: plan.draftRevisionId,
    dryRun,
    tables: plan.tables,
    renumbered: plan.renumbered,
  };
}

function staleRepairOf(plan: SchemaLedgerRepairPlan): SchemaLedgerRepair {
  return {
    ...repairResultOf(plan, false),
    tables: plan.tables.map(({ tableId }) => ({ tableId, outcome: 'stale' })),
    renumbered: [],
  };
}
