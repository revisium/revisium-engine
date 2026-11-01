import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule } from '@nestjs/config';
import { CommandBus, CqrsModule } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';
import { CommittedVersionsGuard } from 'src/__tests__/assertions/committed-versions-guard';
import { BranchModule } from 'src/features/branch/branch.module';
import { DraftRevisionModule } from 'src/features/draft-revision/draft-revision.module';
import { DraftModule } from 'src/features/draft/draft.module';
import { DraftApiService } from 'src/features/draft/draft-api.service';
import { MigrationApiService } from 'src/features/migration/migration-api.service';
import { MIGRATION_OPTIONS } from 'src/features/migration/migration.consts';
import { MigrationModule } from 'src/features/migration/migration.module';
import { MigrationBatchService } from 'src/features/migration/services/migration-batch.service';
import { MigrationLockService } from 'src/features/migration/services/migration-lock.service';
import { MigrationService } from 'src/features/migration/services/migration.service';
import { MigrationTransitionService } from 'src/features/migration/services/migration-transition.service';
import type { MigrationOptions } from 'src/features/migration/types/migration-options.types';
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
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import { STORAGE_SERVICE } from 'src/infrastructure/storage/storage.interface';
import { StorageModule } from 'src/infrastructure/storage/storage.module';
import { createStorageMock } from 'src/__tests__/kit/storage.mock';
import { WITHOUT_RECURRING_SWEEP } from 'src/__tests__/kit/without-recurring-sweep';
import { transactionTimeoutSetting } from 'src/__tests__/kit/transaction-timeout-setting';
import {
  ExplicitMigrationRecoveryScope,
  restrictMigrationRecovery,
} from 'src/__tests__/kit/migration-recovery-scope';

const DEFAULT_MIGRATION_THRESHOLD = 10;
const DEFAULT_MIGRATION_BATCH_SIZE = 5;

type MigrationTestKitOptions = Pick<
  MigrationOptions,
  | 'threshold'
  | 'batchSize'
  | 'workerMode'
  | 'pollIntervalMs'
  | 'lockTimeoutMs'
  | 'stallTimeoutMs'
> & { recoveryScope?: string[]; transactionTimeoutMs?: number };

export interface MigrationTestKit {
  module: TestingModule;
  prisma: PrismaService;
  draftApi: DraftApiService;
  commandBus: CommandBus;
  rowApi: RowApiService;
  tableApi: TableApiService;
  migrationApi: MigrationApiService;
  migrationBatchService: MigrationBatchService;
  migrationLockService: MigrationLockService;
  migrationService: MigrationService;
  migrationTransitions: MigrationTransitionService;
  transactionService: TransactionPrismaService;
  recoveryScope: ExplicitMigrationRecoveryScope;
  guard: CommittedVersionsGuard;
  close(): Promise<void>;
}

export async function createMigrationTestKit({
  recoveryScope: recoveredMigrationIds,
  transactionTimeoutMs,
  ...options
}: MigrationTestKitOptions = {}): Promise<MigrationTestKit> {
  const recoveryScope = new ExplicitMigrationRecoveryScope(
    recoveredMigrationIds,
  );
  const builder = Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        load: transactionTimeoutSetting(transactionTimeoutMs),
      }),
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
      ...WITHOUT_RECURRING_SWEEP,
      ...options,
      threshold: options.threshold ?? DEFAULT_MIGRATION_THRESHOLD,
      batchSize: options.batchSize ?? DEFAULT_MIGRATION_BATCH_SIZE,
    });
  const module = await restrictMigrationRecovery(
    builder,
    recoveryScope,
  ).compile();

  await module.init();

  const prisma = module.get(PrismaService);

  return {
    module,
    prisma,
    draftApi: module.get(DraftApiService),
    commandBus: module.get(CommandBus),
    rowApi: module.get(RowApiService),
    tableApi: module.get(TableApiService),
    migrationApi: module.get(MigrationApiService),
    migrationBatchService: module.get(MigrationBatchService),
    migrationLockService: module.get(MigrationLockService),
    migrationService: module.get(MigrationService),
    migrationTransitions: module.get(MigrationTransitionService),
    transactionService: module.get(TransactionPrismaService),
    recoveryScope,
    guard: new CommittedVersionsGuard(prisma),
    async close() {
      await module.close();
    },
  };
}
