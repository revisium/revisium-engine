import { DynamicModule, Global, Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
import { ShareModule } from 'src/features/share/share.module';
import { PluginModule } from 'src/features/plugin/plugin.module';
import { FileUsageModule } from 'src/features/file-usage/file-usage.module';
import { DraftModule } from 'src/features/draft/draft.module';
import { DraftRevisionModule } from 'src/features/draft-revision/draft-revision.module';
import { MigrationLockService } from 'src/features/migration/services/migration-lock.service';
import { MigrationService } from 'src/features/migration/services/migration.service';
import { MigrationWorkerService } from 'src/features/migration/services/migration-worker.service';
import { MigrationBatchService } from 'src/features/migration/services/migration-batch.service';
import { MigrationLeases } from 'src/features/migration/services/migration-leases';
import { MigrationStallRecovery } from 'src/features/migration/services/migration-stall-recovery';
import { MigrationTransitions } from 'src/features/migration/services/migration-transitions';
import { MigrationSwapService } from 'src/features/migration/services/migration-swap.service';
import { SwapRecheckService } from 'src/features/migration/services/swap-recheck.service';
import { LegacyMigrationDisposalService } from 'src/features/migration/services/legacy-migration-disposal.service';
import { HeldMigrationLeases } from 'src/features/migration/services/held-migration-leases';
import { MigrationDrivers } from 'src/features/migration/services/migration-drivers';
import { MigrationImportService } from 'src/features/migration/services/migration-import.service';
import { MigrationApiService } from 'src/features/migration/migration-api.service';
import { RepairStateReader } from 'src/features/migration/ledger-repair/repair-state-reader';
import { DraftRowsValidation } from 'src/features/migration/ledger-repair/draft-rows-validation';
import { RepairPlanning } from 'src/features/migration/ledger-repair/repair-planning';
import { RepairFreshness } from 'src/features/migration/ledger-repair/repair-freshness';
import { RepairWriter } from 'src/features/migration/ledger-repair/repair-writer';
import { StoredLedgerVerification } from 'src/features/migration/ledger-repair/stored-ledger-verification';
import { BranchPageReader } from 'src/features/migration/ledger-scan/branch-page-reader';
import { ScanRevisionReader } from 'src/features/migration/ledger-scan/scan-revision-reader';
import { MIGRATION_OPTIONS } from 'src/features/migration/migration.consts';
import { MIGRATION_QUERY_HANDLERS } from 'src/features/migration/queries/handlers';
import { MIGRATION_COMMAND_HANDLERS } from 'src/features/migration/commands/handlers';
import type { MigrationOptions } from 'src/features/migration/types/migration-options.types';

const SERVICES = [
  MigrationLockService,
  MigrationService,
  MigrationBatchService,
  MigrationWorkerService,
  MigrationLeases,
  MigrationStallRecovery,
  MigrationTransitions,
  MigrationSwapService,
  SwapRecheckService,
  LegacyMigrationDisposalService,
  HeldMigrationLeases,
  MigrationDrivers,
  MigrationImportService,
  MigrationApiService,
  RepairStateReader,
  DraftRowsValidation,
  RepairPlanning,
  RepairFreshness,
  RepairWriter,
  StoredLedgerVerification,
  BranchPageReader,
  ScanRevisionReader,
  ...MIGRATION_QUERY_HANDLERS,
  ...MIGRATION_COMMAND_HANDLERS,
];

const EXPORTS = [
  MigrationLockService,
  MigrationService,
  MigrationImportService,
  MigrationApiService,
];

@Global()
@Module({})
export class MigrationModule {
  static forRoot(options?: MigrationOptions): DynamicModule {
    return {
      module: MigrationModule,
      imports: [
        DatabaseModule,
        CqrsModule,
        ShareModule,
        PluginModule,
        FileUsageModule,
        DraftRevisionModule,
        DraftModule,
      ],
      providers: [
        {
          provide: MIGRATION_OPTIONS,
          useValue: options ?? {},
        },
        ...SERVICES,
      ],
      exports: EXPORTS,
    };
  }
}
