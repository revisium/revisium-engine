import { Injectable } from '@nestjs/common';
import {
  reportedRowCountsSql,
  type TableRows,
} from 'src/features/partial-changes/draft-reads/reported-rows-sql';
import type { RevisionChangeSummary } from 'src/features/revision-changes/types';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

export interface ReportedRowCounts extends RevisionChangeSummary {
  readonly rowsWithUnits: number;
}

@Injectable()
export class ReportedRowCountsReader {
  constructor(private readonly transactionService: TransactionPrismaService) {}

  private get transaction() {
    return this.transactionService.getTransaction();
  }

  public async readRowCounts(rows: TableRows): Promise<ReportedRowCounts> {
    const [counts] = await this.transaction.$queryRaw<ReportedRowCounts[]>(
      reportedRowCountsSql(rows),
    );

    if (!counts) {
      throw new Error('The count of the reported rows returned no row');
    }

    return counts;
  }
}
