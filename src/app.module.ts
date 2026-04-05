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
import { RevisionChangesModule } from 'src/features/revision-changes/revision-changes.module';
import { SubSchemaModule } from 'src/features/sub-schema/sub-schema.module';
import { ViewsModule } from 'src/features/views/views.module';
import { IStorageService } from 'src/infrastructure/storage/storage.interface';

export interface EngineModuleOptions {
  storage?: IStorageService;
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CqrsModule,
    DatabaseModule,
    StorageModule.forRoot(),
    ...FEATURE_MODULES,
  ],
  providers: [EngineApiService],
  exports: [EngineApiService],
})
export class AppModule {
  static forRoot(options?: EngineModuleOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        CqrsModule,
        DatabaseModule,
        StorageModule.forRoot(options?.storage),
        ...FEATURE_MODULES,
      ],
      providers: [EngineApiService],
      exports: [EngineApiService],
    };
  }
}
