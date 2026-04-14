import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';
import { BranchModule } from 'src/features/branch/branch.module';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

export interface BranchTestKit {
  module: TestingModule;
  prismaService: PrismaService;
  transactionService: TransactionPrismaService;
  commandBus: CommandBus;
  queryBus: QueryBus;
  close(): Promise<void>;
}

export async function createBranchTestKit(): Promise<BranchTestKit> {
  const module = await Test.createTestingModule({
    imports: [BranchModule],
  }).compile();

  await module.init();

  return {
    module,
    prismaService: module.get(PrismaService),
    transactionService: module.get(TransactionPrismaService),
    commandBus: module.get(CommandBus),
    queryBus: module.get(QueryBus),
    async close() {
      await module.close();
    },
  };
}
