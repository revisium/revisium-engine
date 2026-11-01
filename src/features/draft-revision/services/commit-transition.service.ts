import { Injectable } from '@nestjs/common';
import { versionRefsOf } from 'src/features/draft-revision/commands/impl/target-write-plan';
import { DraftRevisionInternalService } from 'src/features/draft-revision/services/draft-revision-internal.service';
import { IdService } from 'src/infrastructure/database/id.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

export interface TableVersionRef {
  readonly versionId: string;
}

export interface TableLinkReplacement {
  readonly replacedVersionId?: string;
  readonly versionId?: string;
}

export interface NextDraft {
  readonly branchId: string;
  readonly parentRevisionId: string;
  readonly tables: readonly TableVersionRef[];
}

@Injectable()
export class CommitTransition {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly idService: IdService,
    private readonly internalService: DraftRevisionInternalService,
  ) {}

  private get transaction() {
    return this.transactionService.getTransaction();
  }

  public async relinkedTablesOf(
    revisionId: string,
    replacements: readonly TableLinkReplacement[],
  ): Promise<TableVersionRef[]> {
    const linked =
      await this.internalService.getRevisionTableVersionIds(revisionId);
    const replaced = new Set(
      replacements.map(({ replacedVersionId }) => replacedVersionId),
    );
    const kept = linked.filter(({ versionId }) => !replaced.has(versionId));
    const linkedInstead = replacements.flatMap(({ versionId }) =>
      versionRefsOf(versionId),
    );

    return [...kept, ...linkedInstead];
  }

  public async retireHead(revisionId: string): Promise<void> {
    await this.transaction.revision.update({
      where: { id: revisionId },
      data: { isHead: false, isDraft: false, hasChanges: false },
    });
  }

  public async promoteDraftToHead(
    revisionId: string,
    comment?: string,
    tables?: readonly TableVersionRef[],
  ): Promise<void> {
    await this.transaction.revision.update({
      where: { id: revisionId },
      data: {
        isHead: true,
        isDraft: false,
        hasChanges: false,
        comment,
        tables: tableLinksReplacedBy(tables),
      },
    });
  }

  public async openNextDraft({
    branchId,
    parentRevisionId,
    tables,
  }: NextDraft): Promise<string> {
    const { id } = await this.transaction.revision.create({
      data: {
        id: this.idService.generate(),
        isDraft: true,
        hasChanges: false,
        parent: { connect: { id: parentRevisionId } },
        tables: { connect: [...tables] },
        branch: { connect: { id: branchId } },
      },
      select: { id: true },
    });

    return id;
  }
}

function tableLinksReplacedBy(
  tables: readonly TableVersionRef[] | undefined,
): { set: TableVersionRef[] } | undefined {
  if (tables === undefined) {
    return undefined;
  }

  return { set: [...tables] };
}
