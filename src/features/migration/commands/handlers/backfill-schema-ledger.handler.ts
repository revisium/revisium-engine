import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { DraftWriteAdmissionService } from 'src/features/draft/draft-write-admission.service';
import {
  type BackfillCommitted,
  type BackfillEntry,
  BackfillSchemaLedgerCommand,
  type BackfillSchemaLedgerData,
  type SchemaLedgerBackfill,
} from 'src/features/migration/commands/impl/backfill-schema-ledger.command';
import type { BackfillMigration } from 'src/features/migration/ledger-backfill/backfill-migrations';
import {
  type BackfillRequest,
  backfillRequestOf,
} from 'src/features/migration/ledger-backfill/backfill-request';
import {
  type BackfillState,
  BackfillStateReader,
} from 'src/features/migration/ledger-backfill/backfill-state-reader';
import { BackfillWriter } from 'src/features/migration/ledger-backfill/backfill-writer';
import {
  type BackfillPlan,
  LedgerBackfillPlanService,
} from 'src/features/migration/ledger-backfill/ledger-backfill-plan.service';
import { StoredBackfillVerification } from 'src/features/migration/ledger-backfill/stored-backfill-verification';
import {
  backfillFieldsOf,
  ledgerOperation,
} from 'src/features/migration/ledger-operation-log';
import type { HeadAndDraft } from 'src/features/share/branch-revisions/branch-revision-reader';
import { ShareCommands } from 'src/features/share/share.commands';
import type { DeadlineHandle } from 'src/infrastructure/database/operation-deadline';
import { OperationTransactionRunner } from 'src/infrastructure/database/operation-transaction-runner';
import {
  OperationLog,
  type OperationTrace,
} from 'src/infrastructure/database/operation-log';

@CommandHandler(BackfillSchemaLedgerCommand)
export class BackfillSchemaLedgerHandler implements ICommandHandler<
  BackfillSchemaLedgerCommand,
  SchemaLedgerBackfill
> {
  constructor(
    private readonly transactionRunner: OperationTransactionRunner,
    private readonly writeAdmission: DraftWriteAdmissionService,
    private readonly stateReader: BackfillStateReader,
    private readonly planService: LedgerBackfillPlanService,
    private readonly writer: BackfillWriter,
    private readonly verification: StoredBackfillVerification,
    private readonly shareCommands: ShareCommands,
    private readonly operationLog: OperationLog,
  ) {}

  public async execute({
    data,
  }: BackfillSchemaLedgerCommand): Promise<SchemaLedgerBackfill> {
    const backfill = await this.operationLog.track(
      ledgerOperation('backfill', data),
      async (trace) => {
        const result = await this.backfill(data, trace);
        trace.described(() => backfillFieldsOf(result));

        return result;
      },
    );

    await this.notifyWhenBackfilled(backfill);

    return backfill;
  }

  private backfill(
    data: BackfillSchemaLedgerData,
    trace: OperationTrace,
  ): Promise<SchemaLedgerBackfill> {
    const request = backfillRequestOf(data);
    trace.described(() => ({ dryRun: request.dryRun }));

    if (request.dryRun) {
      return this.transactionRunner.runPlanning(
        () => this.planBackfill(request),
        trace,
      );
    }

    return this.transactionRunner.runWrite(
      request,
      (deadline) => this.planAndWrite(request, deadline),
      trace,
    );
  }

  private async planBackfill(
    request: BackfillRequest,
  ): Promise<SchemaLedgerBackfill> {
    const state = await this.stateReader.readUnlockedBranch(request);

    return backfillResultOf(state, this.planService.plan(state));
  }

  private async planAndWrite(
    request: BackfillRequest,
    deadline: DeadlineHandle,
  ): Promise<SchemaLedgerBackfill> {
    await this.writeAdmission.admitBranchWrite(
      request.projectId,
      request.branchName,
    );

    const state = await this.stateReader.readUnlockedBranch(request);
    const plan = this.planService.plan(state);

    if (plan.status !== 'planned') {
      return backfillResultOf(state, plan);
    }

    await deadline.checkpoint();

    return this.writeBackfill(state, plan.migrations, request.comment);
  }

  private async writeBackfill(
    state: BackfillState,
    migrations: readonly BackfillMigration[],
    comment: string,
  ): Promise<BackfillCommitted> {
    const committed = await this.writer.write(state, migrations, comment);

    await this.verification.verify(committed, migrations);

    return {
      status: 'backfilled',
      previousHeadRevisionId: committed.previousHeadRevisionId,
      headRevisionId: committed.headRevisionId,
      draftRevisionId: committed.draftRevisionId,
      entries: entriesOf(migrations),
    };
  }

  private async notifyWhenBackfilled(
    backfill: SchemaLedgerBackfill,
  ): Promise<void> {
    if (backfill.status !== 'backfilled') {
      return;
    }

    await this.shareCommands.notifyEndpoints({
      revisionId: backfill.headRevisionId,
    });
    await this.shareCommands.notifyEndpoints({
      revisionId: backfill.draftRevisionId,
    });
  }
}

function backfillResultOf(
  { headRevisionId, draftRevisionId }: HeadAndDraft,
  plan: BackfillPlan,
): SchemaLedgerBackfill {
  const branch = { headRevisionId, draftRevisionId };

  if (plan.status === 'planned') {
    return {
      status: 'planned',
      ...branch,
      entries: entriesOf(plan.migrations),
    };
  }

  if (plan.status === 'refused') {
    return { status: 'refused', ...branch, refusal: plan.refusal };
  }

  return { status: 'notNeeded', ...branch };
}

function entriesOf(migrations: readonly BackfillMigration[]): BackfillEntry[] {
  return migrations.map(({ id, changeType, tableId, hash }) => ({
    id,
    changeType,
    tableId,
    hash,
  }));
}
