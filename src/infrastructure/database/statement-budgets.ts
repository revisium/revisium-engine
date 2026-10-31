import { AsyncLocalStorage } from 'node:async_hooks';
import { TransactionPrismaClient } from 'src/features/share/types';
import {
  OperationDeadline,
  setLocalTimeoutToDeadline,
} from 'src/infrastructure/database/operation-deadline';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import {
  TransactionOptions,
  TransactionPrismaService,
} from 'src/infrastructure/database/transaction-prisma.service';

export class StatementBudgets {
  private readonly deadlines = new AsyncLocalStorage<OperationDeadline>();

  private readonly budgetedPrisma;

  constructor(
    prismaService: PrismaService,
    private readonly transactionService: TransactionPrismaService,
  ) {
    this.budgetedPrisma = prismaService.$extends({
      query: {
        $allOperations: async ({ args, query }) => {
          await this.limitStatementToDeadline();
          return query(args);
        },
      },
    });
  }

  public runTransaction<T>(
    deadline: OperationDeadline,
    options: Omit<TransactionOptions, 'retry'>,
    body: () => Promise<T>,
  ): Promise<T> {
    return this.budgetedPrisma.$transaction(
      ($prisma) =>
        this.deadlines.run(deadline, () =>
          this.transactionService.runInTransactionContext(
            $prisma as TransactionPrismaClient,
            body,
          ),
        ),
      options,
    );
  }

  private async limitStatementToDeadline(): Promise<void> {
    const deadline = this.deadlines.getStore();

    if (!deadline) {
      return;
    }

    // The limiting statement passes through this hook too; outside the deadline scope it is not limited again.
    await this.deadlines.exit(() =>
      setLocalTimeoutToDeadline(
        this.transactionService.getTransaction(),
        'statement_timeout',
        deadline,
      ),
    );
  }
}
