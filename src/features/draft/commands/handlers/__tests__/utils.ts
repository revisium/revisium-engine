import { CacheModule } from '@nestjs/cache-manager';
import { CqrsModule } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';
import { ShareModule } from 'src/features/share/share.module';
import { ShareTransactionalQueries } from 'src/features/share/share.transactional.queries';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

export const createTestingModule = async () => {
  const module: TestingModule = await Test.createTestingModule({
    imports: [DatabaseModule, CqrsModule, ShareModule, CacheModule.register()],
  }).compile();

  await module.init();

  const prismaService = module.get(PrismaService);
  const transactionService = module.get(TransactionPrismaService);
  const shareTransactionalQueries = module.get(ShareTransactionalQueries);

  return {
    module,
    prismaService,
    transactionService,
    shareTransactionalQueries,
  };
};
