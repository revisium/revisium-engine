import { Injectable } from '@nestjs/common';
import {
  getPreviousRowStatesSql,
  type PreviousRowStateSqlResult,
  type PreviousRowStatesSqlParams,
} from 'src/features/row/utils/get-previous-row-states-sql';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@Injectable()
export class PreviousRowStatesReader {
  constructor(private readonly transactionService: TransactionPrismaService) {}

  private get prisma() {
    return this.transactionService.getTransactionOrPrisma();
  }

  findSelectedRevision(revisionId: string) {
    return this.prisma.revision.findUnique({
      where: { id: revisionId },
      select: { isDraft: true },
    });
  }

  read(data: PreviousRowStatesSqlParams): Promise<PreviousRowStateSqlResult[]> {
    return this.prisma.$queryRaw<PreviousRowStateSqlResult[]>(
      getPreviousRowStatesSql(data),
    );
  }
}
