import type { Provider } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

export interface DatabaseServiceTestKit {
  module: TestingModule;
  prismaService: PrismaService;
  transactionService: TransactionPrismaService;
  close(): Promise<void>;
}

export async function createDatabaseServiceTestKit(
  providers: Provider[],
): Promise<DatabaseServiceTestKit> {
  const module = await Test.createTestingModule({
    imports: [DatabaseModule],
    providers,
  }).compile();

  await module.init();

  return {
    module,
    prismaService: module.get(PrismaService),
    transactionService: module.get(TransactionPrismaService),
    async close() {
      await module.close();
    },
  };
}
