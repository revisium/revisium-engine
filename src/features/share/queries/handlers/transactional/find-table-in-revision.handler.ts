import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import { FindTableInRevisionQuery } from 'src/features/share/queries/impl/transactional/find-table-in-revision.query';
import { FindTableInRevisionType } from 'src/features/share/queries/types';

@QueryHandler(FindTableInRevisionQuery)
export class FindTableInRevisionHandler implements IQueryHandler<FindTableInRevisionQuery> {
  constructor(private readonly transactionService: TransactionPrismaService) {}

  private get prisma() {
    return this.transactionService.getTransactionOrPrisma();
  }

  async execute({
    data,
  }: FindTableInRevisionQuery): Promise<FindTableInRevisionType | null> {
    return this.prisma.table.findFirst({
      where: {
        id: data.tableId,
        revisions: { some: { id: data.revisionId } },
      },
      select: {
        versionId: true,
        createdId: true,
        createdAt: true,
        updatedAt: true,
        readonly: true,
        system: true,
      },
    });
  }
}
