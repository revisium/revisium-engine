// Engine Module
export { AppModule } from './app.module';
export { AppModule as EngineModule } from './app.module';

// Engine API (unified facade)
export { EngineApiService } from './engine-api.service';

// Infrastructure — Database
export { DatabaseModule } from './infrastructure/database/database.module';
export { PrismaService } from './infrastructure/database/prisma.service';
export { TransactionPrismaService } from './infrastructure/database/transaction-prisma.service';
export type { TransactionOptions } from './infrastructure/database/transaction-prisma.service';
export { IdService } from './infrastructure/database/id.service';
export { HashService } from './infrastructure/database/hash.service';
export { PostgresqlNotificationService } from './infrastructure/database/postgresql-notification.service';
export { CleanupService } from './infrastructure/database/cleanup.service';

// Infrastructure — Storage
export { StorageModule } from './infrastructure/storage/storage.module';
export { STORAGE_SERVICE } from './infrastructure/storage/storage.interface';
export type { IStorageService } from './infrastructure/storage/storage.interface';

// Share
export { ShareModule } from './features/share/share.module';
export { DiffService } from './features/share/diff.service';
export { ForeignKeysService } from './features/share/foreign-keys.service';
export { JsonSchemaStoreService } from './features/share/json-schema-store.service';
export { JsonSchemaValidatorService } from './features/share/json-schema-validator.service';
export { SystemTablesService } from './features/share/system-tables.service';
export { ViewsMigrationService } from './features/share/views-migration.service';
export { ShareTransactionalQueries } from './features/share/share.transactional.queries';
export type { TransactionPrismaClient } from './features/share/types';

// Plugin
export { PluginModule } from './features/plugin/plugin.module';
export { PluginService } from './features/plugin/plugin.service';
export { FormulaValidationService } from './features/plugin/formula/formula-validation.service';
export type {
  IPluginService,
  FormulaFieldError,
  ComputeRowsResult,
  AfterCreateRowOptions,
  AfterUpdateRowOptions,
  ComputeRowsOptions,
  AfterMigrateRowsOptions,
} from './features/plugin/types';

// Revision
export { RevisionModule } from './features/revision/revision.module';
export { RevisionsApiService } from './features/revision/revisions-api.service';

// Branch
export { BranchModule } from './features/branch/branch.module';
export { BranchApiService } from './features/branch/branch-api.service';

// Table
export { TableModule } from './features/table/table.module';
export { TableApiService } from './features/table/table-api.service';

// Row
export { RowModule } from './features/row/row.module';
export { RowApiService } from './features/row/row-api.service';

// Draft Revision
export { DraftRevisionModule } from './features/draft-revision/draft-revision.module';
export { DraftRevisionApiService } from './features/draft-revision/draft-revision-api.service';

// Draft
export { DraftModule } from './features/draft/draft.module';
export { DraftApiService } from './features/draft/draft-api.service';
export { DraftTransactionalCommands } from './features/draft/draft.transactional.commands';

// Revision Changes
export { RevisionChangesModule } from './features/revision-changes/revision-changes.module';
export { RevisionChangesApiService } from './features/revision-changes/revision-changes-api.service';

// Sub-Schema
export { SubSchemaModule } from './features/sub-schema/sub-schema.module';
export { SubSchemaApiService } from './features/sub-schema/sub-schema-api.service';

// Views
export { ViewsModule } from './features/views/views.module';
export { ViewsApiService } from './features/views/views-api.service';
export { ViewValidationService } from './features/views/services/view-validation.service';
export type {
  View,
  ViewColumn,
  ViewFilterGroup,
  ViewSort,
  TableViewsData,
} from './features/views/types';
