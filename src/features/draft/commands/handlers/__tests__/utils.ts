import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';
import { PluginModule } from 'src/features/plugin/plugin.module';
import { PluginService } from 'src/features/plugin/plugin.service';
import { ShareModule } from 'src/features/share/share.module';
import { ShareTransactionalQueries } from 'src/features/share/share.transactional.queries';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { STORAGE_SERVICE } from 'src/infrastructure/storage/storage.interface';
import { StorageModule } from 'src/infrastructure/storage/storage.module';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

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

  return {
    module,
    prismaService,
    transactionService,
    shareTransactionalQueries,
    pluginService,
  };
};
