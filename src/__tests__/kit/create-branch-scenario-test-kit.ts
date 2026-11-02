import { CacheModule } from '@nestjs/cache-manager';
import type { ModuleMetadata } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommandBus, CqrsModule } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';
import { CommittedVersionsGuard } from 'src/__tests__/assertions/committed-versions-guard';
import type { ProviderOverride } from 'src/__tests__/kit/create-database-service-test-kit';
import { restrictedMigrationRecovery } from 'src/__tests__/kit/migration-recovery-scope';
import { createStorageMock } from 'src/__tests__/kit/storage.mock';
import { WITHOUT_RECURRING_SWEEP } from 'src/__tests__/kit/without-recurring-sweep';
import { BranchModule } from 'src/features/branch/branch.module';
import { DraftRevisionApiService } from 'src/features/draft-revision/draft-revision-api.service';
import { DraftRevisionModule } from 'src/features/draft-revision/draft-revision.module';
import { DraftApiService } from 'src/features/draft/draft-api.service';
import { DraftWriteAdmissionService } from 'src/features/draft/draft-write-admission.service';
import { DraftModule } from 'src/features/draft/draft.module';
import { FileUsageModule } from 'src/features/file-usage/file-usage.module';
import { MigrationModule } from 'src/features/migration/migration.module';
import { PluginModule } from 'src/features/plugin/plugin.module';
import { RevisionModule } from 'src/features/revision/revision.module';
import { RowModule } from 'src/features/row/row.module';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import type { SchemaRefs } from 'src/features/share/ledger-replay/native-schema-rules';
import { ShareModule } from 'src/features/share/share.module';
import { TableModule } from 'src/features/table/table.module';
import { ViewsApiService } from 'src/features/views/views-api.service';
import { ViewsModule } from 'src/features/views/views.module';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import { STORAGE_SERVICE } from 'src/infrastructure/storage/storage.interface';
import { StorageModule } from 'src/infrastructure/storage/storage.module';

export interface BranchScenarioTestKit {
  module: TestingModule;
  prisma: PrismaService;
  transactionService: TransactionPrismaService;
  commandBus: CommandBus;
  draftApi: DraftApiService;
  draftRevisionApi: DraftRevisionApiService;
  draftWriteAdmission: DraftWriteAdmissionService;
  viewsApi: ViewsApiService;
  schemaRefs: SchemaRefs;
  guard: CommittedVersionsGuard;
  close(): Promise<void>;
}

export interface BranchScenarioTestKitOptions {
  readonly settings?: Record<string, string>;
  readonly overrides?: readonly ProviderOverride[];
  readonly featureModules?: ModuleMetadata['imports'];
}

export async function createBranchScenarioTestKit({
  settings = {},
  overrides = [],
  featureModules = [],
}: BranchScenarioTestKitOptions = {}): Promise<BranchScenarioTestKit> {
  const builder = Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [() => settings] }),
      DatabaseModule,
      CqrsModule,
      StorageModule.forRoot(),
      ShareModule,
      PluginModule,
      MigrationModule.forRoot(WITHOUT_RECURRING_SWEEP),
      restrictedMigrationRecovery(),
      RevisionModule,
      BranchModule,
      TableModule,
      RowModule,
      DraftRevisionModule,
      DraftModule,
      ViewsModule,
      FileUsageModule,
      ...featureModules,
      CacheModule.register(),
    ],
  })
    .overrideProvider(STORAGE_SERVICE)
    .useValue(createStorageMock());

  for (const { provide, useValue } of overrides) {
    builder.overrideProvider(provide).useValue(useValue);
  }

  const module = await builder.compile();

  await module.init();

  const prisma = module.get(PrismaService);

  return {
    module,
    prisma,
    transactionService: module.get(TransactionPrismaService),
    commandBus: module.get(CommandBus),
    draftApi: module.get(DraftApiService),
    draftRevisionApi: module.get(DraftRevisionApiService),
    draftWriteAdmission: module.get(DraftWriteAdmissionService),
    viewsApi: module.get(ViewsApiService),
    schemaRefs: module.get(JsonSchemaStoreService).refs,
    guard: new CommittedVersionsGuard(prisma),
    async close() {
      await module.close();
    },
  };
}
