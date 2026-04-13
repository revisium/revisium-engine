import { DynamicModule, Global, Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
import { ShareModule } from 'src/features/share/share.module';
import { PluginModule } from 'src/features/plugin/plugin.module';
import { MigrationLockService } from 'src/features/migration/services/migration-lock.service';
import { MigrationService } from 'src/features/migration/services/migration.service';
import { MigrationWorkerService } from 'src/features/migration/services/migration-worker.service';
import { MigrationBatchService } from 'src/features/migration/services/migration-batch.service';
import { MigrationProgressService } from 'src/features/migration/services/migration-progress.service';
import { MigrationApiService } from 'src/features/migration/migration-api.service';
import { MIGRATION_OPTIONS } from 'src/features/migration/migration.consts';
import { MIGRATION_QUERY_HANDLERS } from 'src/features/migration/queries/handlers';
import { MIGRATION_COMMAND_HANDLERS } from 'src/features/migration/commands/handlers';
import type { MigrationOptions } from 'src/features/migration/types/migration-options.types';

const SERVICES = [
  MigrationLockService,
  MigrationService,
  MigrationBatchService,
  MigrationWorkerService,
  MigrationProgressService,
  MigrationApiService,
  ...MIGRATION_QUERY_HANDLERS,
  ...MIGRATION_COMMAND_HANDLERS,
];

const EXPORTS = [MigrationLockService, MigrationService, MigrationApiService];

@Global()
@Module({})
export class MigrationModule {
  static forRoot(options?: MigrationOptions): DynamicModule {
    return {
      module: MigrationModule,
      imports: [DatabaseModule, CqrsModule, ShareModule, PluginModule],
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
