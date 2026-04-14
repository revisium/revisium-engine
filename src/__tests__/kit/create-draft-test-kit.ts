import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule } from '@nestjs/config';
import { CommandBus, CqrsModule, QueryBus } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';
import { BranchModule } from 'src/features/branch/branch.module';
import { DraftRevisionModule } from 'src/features/draft-revision/draft-revision.module';
import { DraftModule } from 'src/features/draft/draft.module';
import { DraftApiService } from 'src/features/draft/draft-api.service';
import { DraftContextService } from 'src/features/draft/draft-context.service';
import { MigrationContextService } from 'src/features/draft/migration-context.service';
import { DraftTransactionalCommands } from 'src/features/draft/draft.transactional.commands';
import { MigrationModule } from 'src/features/migration/migration.module';
import { PluginModule } from 'src/features/plugin/plugin.module';
import { PluginService } from 'src/features/plugin/plugin.service';
import { RevisionModule } from 'src/features/revision/revision.module';
import { RowApiService } from 'src/features/row/row-api.service';
import { RowModule } from 'src/features/row/row.module';
import { ShareModule } from 'src/features/share/share.module';
import { ShareTransactionalQueries } from 'src/features/share/share.transactional.queries';
import { ViewsMigrationService } from 'src/features/share/views-migration.service';
import { TableApiService } from 'src/features/table/table-api.service';
import { TableModule } from 'src/features/table/table.module';
import { ViewsModule } from 'src/features/views/views.module';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import { STORAGE_SERVICE } from 'src/infrastructure/storage/storage.interface';
import { StorageModule } from 'src/infrastructure/storage/storage.module';
import { createStorageMock } from 'src/__tests__/kit/storage.mock';

export interface DraftTestKit {
  module: TestingModule;
  prismaService: PrismaService;
  transactionService: TransactionPrismaService;
  shareTransactionalQueries: ShareTransactionalQueries;
  pluginService: PluginService;
  rowApiService: RowApiService;
  tableApiService: TableApiService;
  queryBus: QueryBus;
  commandBus: CommandBus;
  draftApiService: DraftApiService;
  draftContextService: DraftContextService;
  draftTransactionalCommands: DraftTransactionalCommands;
  migrationContextService: MigrationContextService;
  viewsMigrationService: ViewsMigrationService;
  close(): Promise<void>;
}

export async function createDraftTestKit(): Promise<DraftTestKit> {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      DatabaseModule,
      CqrsModule,
      StorageModule.forRoot(),
      ShareModule,
      PluginModule,
      MigrationModule.forRoot(),
      RevisionModule,
      BranchModule,
      TableModule,
      RowModule,
      DraftRevisionModule,
      DraftModule,
      ViewsModule,
      CacheModule.register(),
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
    shareTransactionalQueries: module.get(ShareTransactionalQueries),
    pluginService: module.get(PluginService),
    rowApiService: module.get(RowApiService),
    tableApiService: module.get(TableApiService),
    queryBus: module.get(QueryBus),
    commandBus: module.get(CommandBus),
    draftApiService: module.get(DraftApiService),
    draftContextService: module.get(DraftContextService),
    draftTransactionalCommands: module.get(DraftTransactionalCommands),
    migrationContextService: module
      .select(DraftModule)
      .get(MigrationContextService, { strict: true }),
    viewsMigrationService: module.get(ViewsMigrationService),
    async close() {
      await module.close();
    },
  };
}
