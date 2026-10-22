import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule } from '@nestjs/config';
import { CommandBus, CqrsModule, QueryBus } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';
import { createStorageMock } from 'src/__tests__/kit/storage.mock';
import { BranchModule } from 'src/features/branch/branch.module';
import { DraftRevisionModule } from 'src/features/draft-revision/draft-revision.module';
import { DraftApiService } from 'src/features/draft/draft-api.service';
import { DraftModule } from 'src/features/draft/draft.module';
import { FileUsageModule } from 'src/features/file-usage/file-usage.module';
import { FileUsageIntegrationService } from 'src/features/file-usage/services/file-usage-integration.service';
import { MigrationModule } from 'src/features/migration/migration.module';
import { CommittedVersionsGuard } from 'src/features/partial-changes-poc/__tests__/support/committed-versions-guard';
import { MigrationService } from 'src/features/migration/services/migration.service';
import type { MigrationOptions } from 'src/features/migration/types/migration-options.types';
import { PartialChangesApiService } from 'src/features/partial-changes-poc/partial-changes-api.service';
import { PartialChangesPocModule } from 'src/features/partial-changes-poc/partial-changes-poc.module';
import {
  OperationLimits,
  OperationLimitValues,
} from 'src/features/partial-changes-poc/planning/operation-limits.service';
import { PluginModule } from 'src/features/plugin/plugin.module';
import { RevisionChangesApiService } from 'src/features/revision-changes/revision-changes-api.service';
import { RevisionChangesModule } from 'src/features/revision-changes/revision-changes.module';
import { RevisionModule } from 'src/features/revision/revision.module';
import { RowApiService } from 'src/features/row/row-api.service';
import { RowModule } from 'src/features/row/row.module';
import { DiffService } from 'src/features/share/diff.service';
import { ShareModule } from 'src/features/share/share.module';
import { TableModule } from 'src/features/table/table.module';
import { ViewsModule } from 'src/features/views/views.module';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { STORAGE_SERVICE } from 'src/infrastructure/storage/storage.interface';
import { StorageModule } from 'src/infrastructure/storage/storage.module';

export interface PartialChangesTestKit {
  module: TestingModule;
  prisma: PrismaService;
  commandBus: CommandBus;
  queryBus: QueryBus;
  draftApi: DraftApiService;
  rowApi: RowApiService;
  revisionChanges: RevisionChangesApiService;
  changes: PartialChangesApiService;
  diffService: DiffService;
  fileUsageIntegration: FileUsageIntegrationService;
  migrations: MigrationService;
  storage: ReturnType<typeof createStorageMock>;
  guard: CommittedVersionsGuard;
  close(): Promise<void>;
}

export async function createPartialChangesTestKit(
  options: {
    migrationOptions?: MigrationOptions;
    limits?: OperationLimitValues;
  } = {},
): Promise<PartialChangesTestKit> {
  const storage = createStorageMock();
  const builder = Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      DatabaseModule,
      CqrsModule,
      StorageModule.forRoot(),
      ShareModule,
      PluginModule,
      MigrationModule.forRoot(options.migrationOptions),
      RevisionModule,
      BranchModule,
      TableModule,
      RowModule,
      DraftRevisionModule,
      DraftModule,
      ViewsModule,
      FileUsageModule,
      RevisionChangesModule,
      PartialChangesPocModule,
      CacheModule.register(),
    ],
  })
    .overrideProvider(STORAGE_SERVICE)
    .useValue(storage);
  const { limits } = options;
  if (limits) {
    builder
      .overrideProvider(OperationLimits)
      .useValue({ values: () => limits });
  }
  const module = await builder.compile();

  await module.init();
  const prisma = module.get(PrismaService);

  return {
    module,
    prisma,
    commandBus: module.get(CommandBus),
    queryBus: module.get(QueryBus),
    draftApi: module.get(DraftApiService),
    rowApi: module.get(RowApiService),
    revisionChanges: module.get(RevisionChangesApiService),
    changes: module.get(PartialChangesApiService),
    diffService: module.get(DiffService),
    fileUsageIntegration: module.get(FileUsageIntegrationService),
    migrations: module.get(MigrationService),
    storage,
    guard: new CommittedVersionsGuard(prisma),
    async close() {
      await module.close();
    },
  };
}
