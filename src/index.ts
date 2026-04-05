// Engine Module
export { AppModule } from './app.module';
export { AppModule as EngineModule } from './app.module';
export type { EngineModuleOptions } from './app.module';

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

// Draft Command Data Types
export type { ApiCreateRevisionCommandData } from './features/draft/commands/impl/api-create-revision.command';
export type { ApiCreateRevisionCommandReturnType } from './features/draft/commands/impl/api-create-revision.command';
export type { ApiCreateRowCommandData } from './features/draft/commands/impl/api-create-row.command';
export type { ApiCreateRowsCommandData } from './features/draft/commands/impl/api-create-rows.command';
export type { ApiCreateTableCommandData } from './features/draft/commands/impl/api-create-table.command';
export type { ApiPatchRowCommandData } from './features/draft/commands/impl/api-patch-row.command';
export type { ApiPatchRowsCommandData } from './features/draft/commands/impl/api-patch-rows.command';
export type { ApiRemoveRowCommandData } from './features/draft/commands/impl/api-remove-row.command';
export type { ApiRemoveRowsCommandData } from './features/draft/commands/impl/api-remove-rows.command';
export type { ApiRemoveTableCommandData } from './features/draft/commands/impl/api-remove-table.command';
export type { ApiRenameRowCommandData } from './features/draft/commands/impl/api-rename-row.command';
export type { ApiRenameTableCommandData } from './features/draft/commands/impl/api-rename-table.command';
export type { ApiRevertChangesCommandData } from './features/draft/commands/impl/api-revert-changes.command';
export type { ApiUpdateRowCommandData } from './features/draft/commands/impl/api-update-row.command';
export type { ApiUpdateRowsCommandData } from './features/draft/commands/impl/api-update-rows.command';
export type { ApiUpdateTableCommandData } from './features/draft/commands/impl/api-update-table.command';
export type { ApiUploadFileCommandData } from './features/draft/commands/impl/api-upload-file.command';
export type { ApplyMigrationCommandData } from './features/draft/commands/impl/migration';

// Row Query Data Types
export type { GetRowQueryData } from './features/row/queries/impl';
export type { GetRowByIdQueryData } from './features/row/queries/impl';
export type { GetRowsQueryData } from './features/row/queries/impl';
export type { SearchRowsQueryData } from './features/row/queries/impl';
export type {
  SearchMatch,
  SearchRowsResponse,
  SearchRowResult,
} from './features/row/queries/impl';
export type { ResolveRowForeignKeysByQueryData } from './features/row/queries/impl';
export type { ResolveRowForeignKeysToQueryData } from './features/row/queries/impl';
export type { ResolveRowCountForeignKeysByQueryData } from './features/row/queries/impl';
export type { ResolveRowCountForeignKeysToQueryData } from './features/row/queries/impl';

// Table Query Data Types
export type { GetTableQueryData } from './features/table/queries/impl';
export type { GetTablesQueryData } from './features/table/queries/impl';
export type { GetCountRowsInTableQueryData } from './features/table/queries/impl';
export type { ResolveTableSchemaQueryData } from './features/table/queries/impl';
export type { ResolveTableForeignKeysByQueryData } from './features/table/queries/impl';
export type { ResolveTableForeignKeysToQueryData } from './features/table/queries/impl';
export type { ResolveTableCountForeignKeysByQueryData } from './features/table/queries/impl';
export type { ResolveTableCountForeignKeysToQueryData } from './features/table/queries/impl';

// Revision Query Data Types
export type { GetRevisionQueryData } from './features/revision/queries/impl';
export type { GetChildrenByRevisionQueryData } from './features/revision/queries/impl';
export type { GetTablesByRevisionIdQueryData } from './features/revision/queries/impl';
export type { GetMigrationsQueryData } from './features/revision/queries/impl';
export type { ResolveParentByRevisionQueryData } from './features/revision/queries/impl';
export type { ResolveChildByRevisionQueryData } from './features/revision/queries/impl';
export type { ResolveChildBranchesByRevisionQueryData } from './features/revision/queries/impl';
export type { ResolveChildBranchesByRevisionQueryReturnType } from './features/revision/queries/impl';
export type { ResolveBranchByRevisionQueryData } from './features/revision/queries/impl';
export type { ResolveBranchByRevisionQueryReturnType } from './features/revision/queries/impl';

// Branch Query Data Types
export type { GetBranchQueryData } from './features/branch/quieries/impl';
export type { GetBranchByIdQueryData } from './features/branch/quieries/impl';
export type { GetBranchesQueryData } from './features/branch/quieries/impl';
export type { GetRevisionsByBranchIdQueryData } from './features/branch/quieries/impl';
export type { ResolveParentBranchByBranchQueryData } from './features/branch/quieries/impl';

// Revision Changes Query Data Types
export type { GetRevisionChangesQueryData } from './features/revision-changes/queries/impl';
export type { GetRowChangesQueryData } from './features/revision-changes/queries/impl';
export type { GetTableChangesQueryData } from './features/revision-changes/queries/impl';

// Engine Prisma Types — for consumers to use without generated client
export type {
  Branch,
  Revision,
  Table,
  Row,
  RowWhereInput,
  InputJsonValue,
  InputJsonObject,
  JsonValue,
} from './engine-prisma-types';
export {
  Sql,
  sql,
  join,
  raw,
  empty,
  SortOrder,
  TransactionIsolationLevel,
} from './engine-prisma-types';
