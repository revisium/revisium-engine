import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TransactionIsolationLevel } from 'src/engine-prisma-types';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

const DEFAULT_TRANSACTION_TIMEOUT_MS = 15_000;

@Injectable()
export class PlanningTransaction {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly configService: ConfigService,
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
        timeout: this.timeout(),
      },
    );
  }

  private timeout(): number {
    const configured = Number(this.configService.get('TRANSACTION_TIMEOUT'));
    return configured > 0 ? configured : DEFAULT_TRANSACTION_TIMEOUT_MS;
  }
}
