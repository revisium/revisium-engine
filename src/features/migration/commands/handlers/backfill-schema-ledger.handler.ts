import { BadRequestException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import {
  type BackfillEntry,
  BackfillSchemaLedgerCommand,
  type SchemaLedgerBackfill,
} from 'src/features/migration/commands/impl/backfill-schema-ledger.command';
import type { BackfillMigration } from 'src/features/migration/ledger-backfill/backfill-migrations';
import {
  type BackfillRequest,
  backfillRequestOf,
} from 'src/features/migration/ledger-backfill/backfill-request';
import { BackfillStateReader } from 'src/features/migration/ledger-backfill/backfill-state-reader';
import {
  type BackfillPlan,
  LedgerBackfillPlanService,
} from 'src/features/migration/ledger-backfill/ledger-backfill-plan.service';
import type { HeadAndDraft } from 'src/features/share/branch-revisions/branch-revision-reader';
import { OperationTransactionRunner } from 'src/infrastructure/database/operation-transaction-runner';

@CommandHandler(BackfillSchemaLedgerCommand)
export class BackfillSchemaLedgerHandler implements ICommandHandler<
  BackfillSchemaLedgerCommand,
  SchemaLedgerBackfill
> {
  constructor(
    private readonly transactionRunner: OperationTransactionRunner,
    private readonly stateReader: BackfillStateReader,
    private readonly planService: LedgerBackfillPlanService,
  ) {}

  public async execute({
    data,
  }: BackfillSchemaLedgerCommand): Promise<SchemaLedgerBackfill> {
    const request = backfillRequestOf(data);

    if (!request.dryRun) {
      throw new BadRequestException(
        'Writing the schema ledger backfill is not available yet; call it with dryRun: true',
      );
    }

    return this.transactionRunner.runPlanning(() => this.planBackfill(request));
  }

  private async planBackfill(
    request: BackfillRequest,
  ): Promise<SchemaLedgerBackfill> {
    const state = await this.stateReader.readUnlockedBranch(request);

    return backfillResultOf(state, this.planService.plan(state));
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
