import { Injectable } from '@nestjs/common';
import { tableHasReportedRowSql } from 'src/features/partial-changes/draft-reads/reported-rows-sql';
import type { ComparedTable } from 'src/features/partial-changes/snapshot/changes-snapshot';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

// The content check of a table whose differences have no unit with an effect: whether its Draft version holds a row
// that differs from Head in what the Draft reads report (draft-reads-v1 §3), which leaves out the schema hash and a
// formula output that the structure keeps.
@Injectable()
export class TableEffectCheck {
  constructor(private readonly transactionService: TransactionPrismaService) {}

  public async hasChangeWithEffect(table: ComparedTable): Promise<boolean> {
    const [result] = await this.transactionService
      .getTransaction()
      .$queryRaw<{ hasReportedRow: boolean }[]>(tableHasReportedRowSql(table));

    return result?.hasReportedRow ?? true;
  }
}
