import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';
import { BranchModule } from 'src/features/branch/branch.module';
import { DraftRevisionModule } from 'src/features/draft-revision/draft-revision.module';
import { DraftModule } from 'src/features/draft/draft.module';
import { DraftApiService } from 'src/features/draft/draft-api.service';
import { MigrationApiService } from 'src/features/migration/migration-api.service';
import { MIGRATION_OPTIONS } from 'src/features/migration/migration.consts';
import { MigrationModule } from 'src/features/migration/migration.module';
import { MigrationProgressService } from 'src/features/migration/services/migration-progress.service';
import { MigrationService } from 'src/features/migration/services/migration.service';
import { PluginModule } from 'src/features/plugin/plugin.module';
import { RevisionModule } from 'src/features/revision/revision.module';
import { RowModule } from 'src/features/row/row.module';
import { RowApiService } from 'src/features/row/row-api.service';
import { ShareModule } from 'src/features/share/share.module';
import { TableModule } from 'src/features/table/table.module';
import { TableApiService } from 'src/features/table/table-api.service';
import { ViewsModule } from 'src/features/views/views.module';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { STORAGE_SERVICE } from 'src/infrastructure/storage/storage.interface';
import { StorageModule } from 'src/infrastructure/storage/storage.module';
import { createStorageMock } from 'src/__tests__/kit/storage.mock';

const DEFAULT_MIGRATION_THRESHOLD = 10;
const DEFAULT_MIGRATION_BATCH_SIZE = 5;

interface MigrationTestKitOptions {
  threshold?: number;
  batchSize?: number;
}

export interface MigrationTestKit {
  module: TestingModule;
  prisma: PrismaService;
  draftApi: DraftApiService;
  rowApi: RowApiService;
  tableApi: TableApiService;
  migrationApi: MigrationApiService;
  migrationService: MigrationService;
  migrationProgressService: MigrationProgressService;
  close(): Promise<void>;
}

export async function createMigrationTestKit(
  options: MigrationTestKitOptions = {},
): Promise<MigrationTestKit> {
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
    .overrideProvider(MIGRATION_OPTIONS)
    .useValue({
      threshold: options.threshold ?? DEFAULT_MIGRATION_THRESHOLD,
      batchSize: options.batchSize ?? DEFAULT_MIGRATION_BATCH_SIZE,
    })
    .compile();

  await module.init();

  return {
    module,
    prisma: module.get(PrismaService),
    draftApi: module.get(DraftApiService),
    rowApi: module.get(RowApiService),
    tableApi: module.get(TableApiService),
    migrationApi: module.get(MigrationApiService),
    migrationService: module.get(MigrationService),
    migrationProgressService: module.get(MigrationProgressService),
    async close() {
      await module.close();
    },
  };
}
