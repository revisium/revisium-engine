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

// File Usage
export { FileUsageModule } from './features/file-usage/file-usage.module';
export { FileUsageApiService } from './features/file-usage/file-usage-api.service';
export { FileReferenceExtractorService } from './features/file-usage/services/file-reference-extractor.service';
export { FileUsageIntegrationService } from './features/file-usage/services/file-usage-integration.service';
export type {
  BackfillProjectFileBlobsResult,
  CleanupOrphanedFileBlobsResult,
  CleanupProjectFileUsageResult,
  ConfirmStorageDeletedResult,
  FileReference,
  PendingStorageDeletion,
  RestoreProjectFileBytesResult,
  ValidateProjectFileBytesResult,
} from './features/file-usage/types';

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

// Share — pagination + const helpers
export type {
  IPageInfo,
  IEdgeType,
  IPaginatedType,
} from './features/share/pagination.interface';
export { getEmptyPaginatedResponse } from './features/share/const';
export {
  getRevisionCursorPagination,
  type CursorPaginationFindManyArgs,
  type FindManyType,
  type ResolveSequenceById,
} from './features/share/commands/utils/getRevisionCursorPagination';

// Share — validation exceptions
export {
  ValidationErrorCode,
  DataValidationException,
  ForeignKeyTableNotFoundException,
  ForeignKeyRowsNotFoundException,
  FormulaValidationException,
  type ValidationErrorDetail,
  type ForeignKeyErrorDetail,
  type FormulaErrorDetail,
  type ValidationErrorContext,
  type ValidationErrorResponse,
  type ForeignKeyErrorResponse,
  type FormulaErrorResponse,
} from './features/share/exceptions/validation.exception';

// Share — schema building blocks
export { CustomSchemeKeywords } from './features/share/schema/consts';
export { sharedFields } from './features/share/schema/shared-fields';
export { historyPatchesSchema } from './features/share/schema/history-patches-schema';
export { jsonPatchSchema } from './features/share/schema/json-patch-schema';
export {
  xFormulaSchema,
  xFormulaRequiresReadOnly,
  foreignKeyExcludesFormula,
  refMetaSchema,
  baseStringFields,
  stringMetaSchema,
  noForeignKeyStringMetaSchema,
  numberMetaSchema,
  booleanMetaSchema,
  objectMetaSchema,
  arrayMetaSchema,
  metaSchema,
  notForeignKeyMetaSchema,
} from './features/share/schema/meta-schema';
export { tableMigrationsSchema } from './features/share/schema/table-migrations-schema';
export { tableViewsSchema } from './features/share/schema/table-views-schema';

// Share — utils
export { sortRevisions } from './features/share/utils/sort-revisions/sort-revisions';
export {
  RESERVED_USERNAMES,
  RESERVED_BRANCH_NAMES,
} from './features/share/utils/validateUrlLikeId/reserved-names';
export {
  VALIDATE_URL_LIKE_ID_ERROR_MESSAGE,
  validateUrlLikeId,
} from './features/share/utils/validateUrlLikeId/validateUrlLikeId';
export {
  RESERVED_BRANCH_NAME_ERROR_MESSAGE,
  BRANCH_NAME_FORMAT_ERROR_MESSAGE,
  validateBranchName,
} from './features/share/utils/validateUrlLikeId/validateBranchName';
export {
  VALIDATE_JSON_FIELD_NAME_ERROR_MESSAGE,
  validateJsonFieldName,
} from './features/share/utils/validateUrlLikeId/validateJsonFieldName';
export {
  ROW_ID_ERROR_MESSAGE,
  validateRowId,
} from './features/share/utils/validateUrlLikeId/validateRowId';
export {
  TABLE_ID_ERROR_MESSAGE,
  TABLE_ID_SYSTEM_PREFIX_ERROR_MESSAGE,
  validateTableId,
} from './features/share/utils/validateUrlLikeId/validateTableId';

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
export {
  ChangeType,
  JsonPatchOp,
  MigrationType,
  RowChangeDetailType,
  type HistoryPatch,
  type JsonPatchOperation,
  type RevisionChangeSummary,
  type SchemaMigrationDetail,
  type ViewChange,
  type ViewsChangeDetail,
} from './features/revision-changes/types';

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

// Schema Ledger Scan, Repair and Backfill — code lists
export {
  DAMAGE_SHAPES,
  DAMAGED_TABLE_REPAIRS,
  FINDING_CODES,
  FINDING_ROLES,
  ROW_DIAGNOSTICS,
  ROW_HASH_REASONS,
  type RowDiagnostics,
  UNLEDGERED_REASONS,
} from './features/migration/queries/impl/scan-schema-ledger.query';
export { REPAIR_OUTCOMES } from './features/migration/queries/impl/plan-schema-ledger-repair.query';
export { TABLE_REPAIR_OUTCOMES } from './features/migration/commands/impl/repair-schema-ledger.command';
export {
  BACKFILL_REFUSAL_CODES,
  BACKFILL_STATUSES,
} from './features/migration/commands/impl/backfill-schema-ledger.command';

// Draft Changes (EngineApiService.changes) — partial-changes-v1 §5.11, draft-reads-v1 §9
export { PartialChangesModule } from './features/partial-changes/partial-changes.module';
export { PartialChangesApiService } from './features/partial-changes/partial-changes-api.service';
export type { ChangesBranch } from './features/partial-changes/snapshot/changes-snapshot';
export {
  ROW_COLUMNS,
  SELECTOR_SIDES,
  UNIT_KINDS,
  type RowColumn,
  type SelectorSide,
  type Unit,
  type UnitKind,
} from './features/partial-changes/catalogue/unit';
export type {
  FieldRef,
  RowRef,
  Selection,
  SelectionInput,
  SelectionItems,
  TableRef,
} from './features/partial-changes/selection/selection';
export type { UnmatchedSelectors } from './features/partial-changes/selection/selection-resolution';
export type {
  DescribedUnitRef,
  ReasonCause,
  RequiredReason,
  RequiredUnit,
  UnitRef,
} from './features/partial-changes/selection/unit-refs';
export {
  STRUCTURE_TABLE_CHANGES,
  type ChangedField,
  type ListChangesInput,
  type ListChangesResult,
  type ListedUnit,
  type StructureChange,
  type StructureTableChange,
} from './features/partial-changes/queries/impl/list-draft-changes.query';
export {
  STRUCTURE_FIELD_CHANGES,
  type StructureFieldChange,
} from './features/partial-changes/structure/table-structure';
export {
  ANNOTATION_KEYWORDS,
  type AnnotationKeyword,
} from './features/partial-changes/structure/normalized-leaf-schema';
export {
  CAUSE_ROLES,
  REASON_SITE_KINDS,
  REQUIRED_REASON_CODES,
  type CauseRole,
  type ReasonSite,
  type ReasonSiteKind,
  type ReferencedEntity,
  type RequiredReasonCode,
} from './features/partial-changes/plan/reason';
export {
  BLOCKER_CODES,
  type BlockerCode,
} from './features/partial-changes/plan/plan-blocker';
export type {
  DeferredPath,
  DeferredRow,
  DeferredValue,
  PlanBlocker,
} from './features/partial-changes/planning/plan-refs';
export type { PlanEstimate } from './features/partial-changes/limits/operation-estimator';
export type { PlanCounts } from './features/partial-changes/planning/change-planner';
export type { TableCoverage } from './features/partial-changes/planning/plan-coverage';
export {
  REFUSAL_CODES,
  type RefusalCode,
  type RefusedTable,
} from './features/partial-changes/head-schema/head-schema-check';
export {
  CHANGE_OPERATIONS,
  type ChangeOperation,
} from './features/partial-changes/plan/change-operation';
export type {
  PlannedPreview,
  PreviewBase,
  PreviewChangesInput,
  PreviewChangesResult,
  StoppedPreview,
} from './features/partial-changes/queries/impl/preview-draft-changes.query';
export {
  PREVIEW_STATUSES,
  type PreviewStatus,
} from './features/partial-changes/planning/plan-decision';
export type {
  CommitChangesInput,
  CommitChangesResult,
  CommittedDraft,
  MigrationRenumbering,
} from './features/partial-changes/commands/impl/commit-draft-changes.command';
export type {
  RevertChangesInput,
  RevertChangesResult,
  RevertedDraft,
} from './features/partial-changes/commands/impl/revert-draft-changes.command';
export {
  APPLY_STATUSES,
  type ApplyStatus,
  type ChangesBlocked,
  type ChangesRequireAdditions,
  type ChangesStale,
  type NothingToApply,
  type UnappliedChanges,
} from './features/partial-changes/commands/impl/apply-changes';
export {
  STALE_CHANGES,
  type StaleChange,
} from './features/partial-changes/plan/fingerprint';
export {
  FIELD_SELECTION_STATES,
  FOLLOW_REASONS,
  GOES_WITH_REASONS,
  ID_EXCHANGE_TERMINATIONS,
  ROW_SELECTION_STATES,
  type ComputedSelection,
  type DraftPageInfo,
  type DraftReadState,
  type DraftTableChangesFilters,
  type FieldSelection,
  type FieldSelectionState,
  type FieldUnitSelection,
  type FollowReason,
  type GoesWithReason,
  type GoesWithSelection,
  type IdExchangeTermination,
  type RefusedSelection,
  type RowSelectionState,
} from './features/partial-changes/queries/impl/draft-reads';
export {
  TABLE_SELECTION_STATES,
  type ContentEqualSelection,
  type DraftTableChangesInput,
  type DraftTableItem,
  type DraftTablePage,
  type SelectableTableSelection,
  type TableSelection,
  type TableSelectionState,
} from './features/partial-changes/queries/impl/get-draft-table-changes.query';
export {
  DRAFT_FIELD_CHANGE_TYPES,
  type DraftColumnChange,
  type DraftFieldChange,
  type DraftFieldChangeType,
  type DraftRowChangesFilters,
  type DraftRowChangesInput,
  type DraftRowItem,
  type DraftRowPage,
  type FollowedUnit,
  type IdExchange,
  type IdTakeover,
  type RowSelection,
} from './features/partial-changes/queries/impl/get-draft-row-changes.query';
export type {
  ChangedSharedSchema,
  DraftChangesSummary,
  DraftChangesSummaryInput,
  TransientTable,
  ViewsOnlyTable,
} from './features/partial-changes/queries/impl/get-draft-changes-summary.query';

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
export { GetPreviousRowStatesQuery } from './features/row/queries/impl';
export type {
  GetPreviousRowStatesQueryData,
  GetPreviousRowStatesQueryReturnType,
  PreviousRowStateNode,
  RowStateIntroductionType,
} from './features/row/queries/impl';
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
