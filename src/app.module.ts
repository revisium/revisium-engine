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
import { FileUsageModule } from 'src/features/file-usage/file-usage.module';
import type { MigrationOptions } from 'src/features/migration/types/migration-options.types';
import { IStorageService } from 'src/infrastructure/storage/storage.interface';

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
  FileUsageModule,
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
