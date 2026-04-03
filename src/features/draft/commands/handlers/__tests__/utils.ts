import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule } from '@nestjs/config';
import { CommandBus, CqrsModule, QueryBus } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';
import {
  getNumberSchema,
  getObjectSchema,
} from '@revisium/schema-toolkit/mocks';
import { JsonObjectSchema } from '@revisium/schema-toolkit/types';
import { BranchModule } from 'src/features/branch/branch.module';
import { PluginModule } from 'src/features/plugin/plugin.module';
import { PluginService } from 'src/features/plugin/plugin.service';
import { RevisionModule } from 'src/features/revision/revision.module';
import { RowModule } from 'src/features/row/row.module';
import { ShareModule } from 'src/features/share/share.module';
import { ShareTransactionalQueries } from 'src/features/share/share.transactional.queries';
import { TableModule } from 'src/features/table/table.module';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { STORAGE_SERVICE } from 'src/infrastructure/storage/storage.interface';
import { StorageModule } from 'src/infrastructure/storage/storage.module';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

export const testSchema: JsonObjectSchema = getObjectSchema({
  ver: getNumberSchema(),
});

const mockStorage = {
  isAvailable: true,
  canServeFiles: false,
  uploadFile: jest.fn().mockResolvedValue({
    key: 'uploads/fake.png',
  }),
  getPublicUrl: jest.fn((key: string) => `http://test-files/${key}`),
};

export const createTestingModule = async () => {
  const module: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      DatabaseModule,
      CqrsModule,
      ShareModule,
      StorageModule,
      PluginModule,
      RevisionModule,
      BranchModule,
      TableModule,
      RowModule,
      CacheModule.register(),
    ],
  })
    .overrideProvider(STORAGE_SERVICE)
    .useValue(mockStorage)
    .compile();

  await module.init();

  const prismaService = module.get(PrismaService);
  const transactionService = module.get(TransactionPrismaService);
  const shareTransactionalQueries = module.get(ShareTransactionalQueries);
  const pluginService = module.get(PluginService);
  const queryBus = module.get(QueryBus);
  const commandBus = module.get(CommandBus);

  return {
    module,
    prismaService,
    transactionService,
    shareTransactionalQueries,
    pluginService,
    queryBus,
    commandBus,
  };
};
