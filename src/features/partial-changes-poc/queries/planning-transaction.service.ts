import { Injectable } from '@nestjs/common';
import { TransactionIsolationLevel } from 'src/engine-prisma-types';
import { OperationLimits } from 'src/features/partial-changes-poc/planning/operation-limits.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@Injectable()
export class PlanningTransaction {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly limits: OperationLimits,
  ) {}

  run<T>(read: () => Promise<T>): Promise<T> {
    return this.transactionService.run(
      async () => {
        await this.transactionService
          .getTransaction()
          .$executeRawUnsafe('SET TRANSACTION READ ONLY');
        return read();
      },
      {
        isolationLevel: TransactionIsolationLevel.RepeatableRead,
        timeout: this.limits.values().operationTimeoutMs,
      },
    );
  }
}
