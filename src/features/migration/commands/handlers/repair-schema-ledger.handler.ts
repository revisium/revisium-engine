import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { DraftWriteAdmissionService } from 'src/features/draft/draft-write-admission.service';
import {
  RepairSchemaLedgerCommand,
  type RepairSchemaLedgerData,
  type SchemaLedgerRepair,
} from 'src/features/migration/commands/impl/repair-schema-ledger.command';
import { RepairFreshness } from 'src/features/migration/ledger-repair/repair-freshness';
import {
  type RepairRequest,
  repairRequestOf,
} from 'src/features/migration/ledger-repair/repair-request';
import {
  LedgerRepairPlanService,
  type PlannedRepair,
  repairedTablesOf,
} from 'src/features/migration/ledger-repair/ledger-repair-plan.service';
import { RepairStateReader } from 'src/features/migration/ledger-repair/repair-state-reader';
import { RepairWriter } from 'src/features/migration/ledger-repair/repair-writer';
import { StoredLedgerVerification } from 'src/features/migration/ledger-repair/stored-ledger-verification';
import type { SchemaLedgerRepairPlan } from 'src/features/migration/queries/impl/plan-schema-ledger-repair.query';
import { ledgerOperation } from 'src/features/migration/ledger-operation-log';
import { ShareCommands } from 'src/features/share/share.commands';
import { OperationTransactionRunner } from 'src/infrastructure/database/operation-transaction-runner';
import {
  type LogFields,
  OperationLog,
  type OperationTrace,
} from 'src/infrastructure/database/operation-log';

// Whether the repair wrote, so that the Draft endpoints are notified after its log entry, as after a commit.
interface FinishedRepair {
  readonly repair: SchemaLedgerRepair;
  readonly written: boolean;
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
    private readonly operationLog: OperationLog,
  ) {}

  public async execute({
    data,
  }: RepairSchemaLedgerCommand): Promise<SchemaLedgerRepair> {
    const { repair, written } = await this.operationLog.track(
      ledgerOperation('repair', data),
      async (trace) => {
        const result = await this.repair(data, trace);
        trace.described(repairDetailsOf(result.repair));
        trace.concluded(repairOutcomeOf(result));

        return result;
      },
    );

    if (written) {
      await this.shareCommands.notifyEndpoints({
        revisionId: repair.draftRevisionId,
      });
    }

    return repair;
  }

  private async repair(
    data: RepairSchemaLedgerData,
    trace: OperationTrace,
  ): Promise<FinishedRepair> {
    const request = repairRequestOf(data);
    trace.described({ dryRun: request.dryRun });
    const planned = await this.transactionRunner.runPlanning(
      () => this.planRepair(request),
      trace,
    );

    if (request.dryRun || repairedTablesOf(planned.plan).length === 0) {
      return {
        repair: repairResultOf(planned.plan, request.dryRun),
        written: false,
      };
    }

    return this.writeRepair(request, planned, trace);
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
    trace: OperationTrace,
  ): Promise<FinishedRepair> {
    const written = await this.writeAdmission.runSerializableRevisionWrite(
      planned.state.draftRevisionId,
      () => {
        trace.attempted(false);

        return this.recordFreshRepair(request, planned);
      },
    );

    if (!written) {
      return { repair: staleRepairOf(planned.plan), written: false };
    }

    return { repair: repairResultOf(planned.plan, false), written: true };
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

function repairOutcomeOf({ repair, written }: FinishedRepair): string {
  if (written) {
    return 'repaired';
  }

  if (repair.dryRun) {
    return 'planned';
  }

  if (repair.tables.some(({ outcome }) => outcome === 'stale')) {
    return 'stale';
  }

  return 'unchanged';
}

function repairDetailsOf({
  headRevisionId,
  draftRevisionId,
  tables,
  renumbered,
}: SchemaLedgerRepair): LogFields {
  return {
    headRevisionId,
    draftRevisionId,
    tables: tables.length,
    repairedTables: tables.filter(({ outcome }) => outcome === 'repaired')
      .length,
    renumbered: renumbered.length,
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
