import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { DraftWriteAdmissionService } from 'src/features/draft/draft-write-admission.service';
import {
  RepairSchemaLedgerCommand,
  type RepairSchemaLedgerData,
  type SchemaLedgerRepair,
} from 'src/features/migration/commands/impl/repair-schema-ledger.command';
import { RepairFreshness } from 'src/features/migration/ledger-repair/repair-freshness';
import {
  LedgerRepairPlanService,
  type PlannedRepair,
  repairedTablesOf,
} from 'src/features/migration/ledger-repair/ledger-repair-plan.service';
import { RepairStateReader } from 'src/features/migration/ledger-repair/repair-state-reader';
import { RepairWriter } from 'src/features/migration/ledger-repair/repair-writer';
import { StoredLedgerVerification } from 'src/features/migration/ledger-repair/stored-ledger-verification';
import type { SchemaLedgerRepairPlan } from 'src/features/migration/queries/impl/plan-schema-ledger-repair.query';
import type { BranchRef } from 'src/features/share/branch-revisions/branch-revision-reader';
import { ShareCommands } from 'src/features/share/share.commands';
import { OperationTransactionRunner } from 'src/infrastructure/database/operation-transaction-runner';

interface RepairRequest extends BranchRef {
  readonly tableIds?: readonly string[];
  readonly dryRun: boolean;
}

@CommandHandler(RepairSchemaLedgerCommand)
export class RepairSchemaLedgerHandler implements ICommandHandler<
  RepairSchemaLedgerCommand,
  SchemaLedgerRepair
> {
  constructor(
    private readonly transactionRunner: OperationTransactionRunner,
    private readonly stateReader: RepairStateReader,
    private readonly repairPlanService: LedgerRepairPlanService,
    private readonly writeAdmission: DraftWriteAdmissionService,
    private readonly freshness: RepairFreshness,
    private readonly writer: RepairWriter,
    private readonly verification: StoredLedgerVerification,
    private readonly shareCommands: ShareCommands,
  ) {}

  public async execute({
    data,
  }: RepairSchemaLedgerCommand): Promise<SchemaLedgerRepair> {
    const request = repairRequestOf(data);
    const planned = await this.transactionRunner.runPlanning(() =>
      this.planRepair(request),
    );

    if (request.dryRun || repairedTablesOf(planned.plan).length === 0) {
      return repairResultOf(planned.plan, request.dryRun);
    }

    return this.writeRepair(request, planned);
  }

  private async planRepair(request: RepairRequest): Promise<PlannedRepair> {
    const state = await this.stateReader.readUnlockedBranch(request);

    return {
      state,
      plan: await this.repairPlanService.plan(state, {
        tableIds: request.tableIds,
      }),
    };
  }

  private async writeRepair(
    request: RepairRequest,
    planned: PlannedRepair,
  ): Promise<SchemaLedgerRepair> {
    const { draftRevisionId } = planned.state;
    const written = await this.writeAdmission.runSerializableRevisionWrite(
      draftRevisionId,
      () => this.recordFreshRepair(request, planned),
    );

    if (!written) {
      return staleRepairOf(planned.plan);
    }

    await this.shareCommands.notifyEndpoints({ revisionId: draftRevisionId });

    return repairResultOf(planned.plan, false);
  }

  private async recordFreshRepair(
    request: RepairRequest,
    planned: PlannedRepair,
  ): Promise<boolean> {
    if (!(await this.freshness.isFresh(request, planned))) {
      return false;
    }

    await this.writer.record(planned);
    await this.verification.verify(request, planned);

    return true;
  }
}

function repairRequestOf({
  projectId,
  branchName,
  tableIds,
  dryRun,
}: RepairSchemaLedgerData): RepairRequest {
  return {
    projectId,
    branchName,
    tableIds: tableIds ?? undefined,
    dryRun: dryRun ?? false,
  };
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
