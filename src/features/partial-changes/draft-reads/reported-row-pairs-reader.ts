import { Injectable } from '@nestjs/common';
import type { TableFilters } from 'src/features/partial-changes/draft-reads/draft-read-request';
import {
  type ReportedRowPairsPage,
  reportedRowPairsPageSql,
  type RowRange,
  type TableRows,
} from 'src/features/partial-changes/draft-reads/reported-rows-sql';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@Injectable()
export class ReportedRowPairsReader {
  constructor(private readonly transactionService: TransactionPrismaService) {}

  private get transaction() {
    return this.transactionService.getTransaction();
  }

  public async readPairsPage(
    rows: TableRows,
    filters: TableFilters,
    range: RowRange,
  ): Promise<ReportedRowPairsPage> {
    const [page] = await this.transaction.$queryRaw<ReportedRowPairsPage[]>(
      reportedRowPairsPageSql(rows, filters, range),
    );

    if (!page) {
      throw new Error('The page of the reported rows returned no row');
    }

    return page;
  }
}
