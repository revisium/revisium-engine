import { Injectable } from '@nestjs/common';
import { IdService } from 'src/infrastructure/database/id.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

export interface TableVersionRef {
  readonly versionId: string;
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
  ) {}

  private get transaction() {
    return this.transactionService.getTransaction();
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
  ): Promise<void> {
    await this.transaction.revision.update({
      where: { id: revisionId },
      data: { isHead: true, isDraft: false, hasChanges: false, comment },
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
