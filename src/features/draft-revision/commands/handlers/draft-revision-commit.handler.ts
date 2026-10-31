import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { DraftRevisionCommitCommand } from 'src/features/draft-revision/commands/impl/draft-revision-commit.command';
import { DraftRevisionCommitCommandReturnType } from 'src/features/draft-revision/commands/impl';
import {
  DraftRevisionInternalService,
  DraftRevisionValidationService,
} from 'src/features/draft-revision/services';
import { IdService } from 'src/infrastructure/database/id.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@CommandHandler(DraftRevisionCommitCommand)
export class DraftRevisionCommitHandler implements ICommandHandler<DraftRevisionCommitCommand> {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly validationService: DraftRevisionValidationService,
    private readonly internalService: DraftRevisionInternalService,
    private readonly idService: IdService,
  ) {}

  private get transaction() {
    return this.transactionService.getTransaction();
  }

  async execute({
    data,
  }: DraftRevisionCommitCommand): Promise<DraftRevisionCommitCommandReturnType> {
    const { branchId, comment } = data;

    const headRevision =
      await this.internalService.findHeadRevisionOrThrow(branchId);
    const draftRevision =
      await this.internalService.findDraftRevisionOrThrow(branchId);

    this.validationService.ensureHasChanges(draftRevision.hasChanges);

    const tableVersionIds =
      await this.internalService.getRevisionTableVersionIds(draftRevision.id);

    await this.updatePreviousHeadRevision(headRevision.id);
    await this.updatePreviousDraftRevision(draftRevision.id, comment);
    const nextDraftRevision = await this.createNextDraftRevision(
      branchId,
      draftRevision.id,
      tableVersionIds,
    );
    await this.lockRowsAndTables(
      draftRevision.id,
      headRevision.id,
      tableVersionIds,
    );

    return {
      previousHeadRevisionId: headRevision.id,
      previousDraftRevisionId: draftRevision.id,
      nextDraftRevisionId: nextDraftRevision.id,
    };
  }

  private updatePreviousHeadRevision(revisionId: string): Promise<unknown> {
    return this.transaction.revision.update({
      where: { id: revisionId },
      data: { isHead: false, isDraft: false, hasChanges: false },
    });
  }

  private updatePreviousDraftRevision(
    revisionId: string,
    comment?: string,
  ): Promise<unknown> {
    return this.transaction.revision.update({
      where: { id: revisionId },
      data: { isHead: true, isDraft: false, hasChanges: false, comment },
    });
  }

  private createNextDraftRevision(
    branchId: string,
    parentRevisionId: string,
    tableVersionIds: { versionId: string }[],
  ): Promise<{ id: string }> {
    return this.transaction.revision.create({
      data: {
        id: this.idService.generate(),
        isDraft: true,
        hasChanges: false,
        parent: { connect: { id: parentRevisionId } },
        tables: { connect: tableVersionIds },
        branch: { connect: { id: branchId } },
      },
      select: { id: true },
    });
  }

  private async lockRowsAndTables(
    revisionId: string,
    previousHeadRevisionId: string,
    tableVersionIds: { versionId: string }[],
  ): Promise<void> {
    if (tableVersionIds.length === 0) {
      return;
    }

    await this.lockDraftOwnedRows(revisionId, previousHeadRevisionId);
    await this.lockTables(tableVersionIds);
  }

  private async lockDraftOwnedRows(
    revisionId: string,
    previousHeadRevisionId: string,
  ): Promise<void> {
    await this.transaction.$executeRaw`
      WITH draft_table AS (
        SELECT "Table"."versionId", "Table"."createdId"
        FROM "_RevisionToTable"
        JOIN "Table" ON "Table"."versionId" = "_RevisionToTable"."B"
        WHERE "_RevisionToTable"."A" = ${revisionId}
          AND "Table"."readonly" = false
      ),
      head_table AS (
        SELECT "Table"."versionId"
        FROM "_RevisionToTable"
        JOIN "Table" ON "Table"."versionId" = "_RevisionToTable"."B"
        WHERE "_RevisionToTable"."A" = ${previousHeadRevisionId}
          AND "Table"."readonly" = true
          AND "Table"."createdId" IN (SELECT "createdId" FROM draft_table)
      )
      UPDATE "Row"
      SET "readonly" = true
      WHERE "readonly" = false
        AND "versionId" IN (
          SELECT draft_link."A"
          FROM "_RowToTable" AS draft_link
          WHERE draft_link."B" IN (SELECT "versionId" FROM draft_table)
            AND NOT EXISTS (
              SELECT 1
              FROM "_RowToTable" AS head_link
              WHERE head_link."B" IN (SELECT "versionId" FROM head_table)
                AND head_link."A" = draft_link."A"
            )
        )
    `;
  }

  private async lockTables(
    tableVersionIds: { versionId: string }[],
  ): Promise<void> {
    await this.transaction.table.updateMany({
      where: { OR: tableVersionIds, readonly: false },
      data: { readonly: true },
    });
  }
}
