import { ConfigModule } from '@nestjs/config';
import { QueryBus, CqrsModule } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';
import { BranchModule } from 'src/features/branch/branch.module';
import { DraftRevisionModule } from 'src/features/draft-revision/draft-revision.module';
import { RevisionModule } from 'src/features/revision/revision.module';
import { RowModule } from 'src/features/row/row.module';
import { ShareTransactionalQueries } from 'src/features/share/share.transactional.queries';
import { ShareModule } from 'src/features/share/share.module';
import { SystemTablesService } from 'src/features/share/system-tables.service';
import { TableModule } from 'src/features/table/table.module';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import { STORAGE_SERVICE } from 'src/infrastructure/storage/storage.interface';
import { StorageModule } from 'src/infrastructure/storage/storage.module';
import { createStorageMock } from 'src/__tests__/kit/storage.mock';

export interface QueryTestKit {
  module: TestingModule;
  prismaService: PrismaService;
  transactionService: TransactionPrismaService;
  queryBus: QueryBus;
  shareTransactionalQueries: ShareTransactionalQueries;
  systemTablesService: SystemTablesService;
  close(): Promise<void>;
}

export async function createQueryTestKit(): Promise<QueryTestKit> {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      DatabaseModule,
      CqrsModule,
      StorageModule.forRoot(),
      ShareModule,
      RevisionModule,
      BranchModule,
      DraftRevisionModule,
      TableModule,
      RowModule,
    ],
  })
    .overrideProvider(STORAGE_SERVICE)
    .useValue(createStorageMock())
    .compile();

  await module.init();

  return {
    module,
    prismaService: module.get(PrismaService),
    transactionService: module.get(TransactionPrismaService),
    queryBus: module.get(QueryBus),
    shareTransactionalQueries: module.get(ShareTransactionalQueries),
    systemTablesService: module.get(SystemTablesService),
    async close() {
      await module.close();
    },
  };
}
