import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { EngineApiService } from 'src/engine-api.service';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
import { ShareModule } from 'src/features/share/share.module';
import { PluginModule } from 'src/features/plugin/plugin.module';
import { StorageModule } from 'src/infrastructure/storage/storage.module';
import { RevisionModule } from 'src/features/revision/revision.module';
import { BranchModule } from 'src/features/branch/branch.module';
import { TableModule } from 'src/features/table/table.module';
import { RowModule } from 'src/features/row/row.module';
import { DraftRevisionModule } from 'src/features/draft-revision/draft-revision.module';
import { DraftModule } from 'src/features/draft/draft.module';
import { MigrationModule } from 'src/features/migration/migration.module';
import { RevisionChangesModule } from 'src/features/revision-changes/revision-changes.module';
import { SubSchemaModule } from 'src/features/sub-schema/sub-schema.module';
import { ViewsModule } from 'src/features/views/views.module';
import { IStorageService } from 'src/infrastructure/storage/storage.interface';

export interface MigrationOptions {
  /** Row count threshold for async migration. Default: 1000. */
  threshold?: number;
  /** Worker mode. Default: 'inline'. */
  workerMode?: 'inline' | 'polling' | 'disabled';
  /** Rows per batch. Default: 1000 */
  batchSize?: number;
  /** Polling interval in ms (polling mode only). Default: 5000 */
  pollIntervalMs?: number;
  /** Heartbeat interval in ms (polling mode). Default: 30000 */
  heartbeatIntervalMs?: number;
  /** Stale lock timeout in ms. Default: 60000 */
  lockTimeoutMs?: number;
  /** Auto-abort if no progress for this duration in ms. Default: 600000 (10 min) */
  stallTimeoutMs?: number;
  /** Max retry count on failure. Default: 3 */
  maxRetries?: number;
}

export interface EngineModuleOptions {
  storage?: IStorageService;
  migration?: MigrationOptions;
}

const FEATURE_MODULES = [
  ShareModule,
  PluginModule,
  RevisionModule,
  BranchModule,
  TableModule,
  RowModule,
  DraftRevisionModule,
  DraftModule,
  RevisionChangesModule,
  SubSchemaModule,
  ViewsModule,
];

@Module({})
export class AppModule {
  static forRoot(options?: EngineModuleOptions): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        CqrsModule,
        DatabaseModule,
        StorageModule.forRoot(options?.storage),
        MigrationModule.forRoot(options?.migration),
        ...FEATURE_MODULES,
      ],
      providers: [EngineApiService],
      exports: [EngineApiService],
    };
  }
}
