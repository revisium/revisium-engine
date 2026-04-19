import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { BranchApiService } from 'src/features/branch/branch-api.service';
import { DraftApiService } from 'src/features/draft/draft-api.service';
import { RevisionChangesApiService } from 'src/features/revision-changes/revision-changes-api.service';
import { RevisionsApiService } from 'src/features/revision/revisions-api.service';
import { RowApiService } from 'src/features/row/row-api.service';
import { SubSchemaApiService } from 'src/features/sub-schema/sub-schema-api.service';
import { TableApiService } from 'src/features/table/table-api.service';
import { ViewsApiService } from 'src/features/views/views-api.service';
import { MigrationApiService } from 'src/features/migration/migration-api.service';
import { CleanupService } from 'src/infrastructure/database/cleanup.service';
import {
  ApiRevertChangesCommand,
  ApiRevertChangesCommandData,
  ApiRevertChangesCommandReturnType,
} from 'src/features/draft/commands/impl/api-revert-changes.command';

@Injectable()
export class EngineApiService {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly draftApi: DraftApiService,
    private readonly rowApi: RowApiService,
    private readonly tableApi: TableApiService,
    private readonly revisionApi: RevisionsApiService,
    private readonly branchApi: BranchApiService,
    private readonly changesApi: RevisionChangesApiService,
    private readonly viewsApi: ViewsApiService,
    private readonly subSchemaApi: SubSchemaApiService,
    private readonly cleanupService: CleanupService,
    private readonly migrationApi: MigrationApiService,
  ) {}

  // --- Tables ---

  createTable(...args: Parameters<DraftApiService['apiCreateTable']>) {
    return this.draftApi.apiCreateTable(...args);
  }

  updateTable(...args: Parameters<DraftApiService['apiUpdateTable']>) {
    return this.draftApi.apiUpdateTable(...args);
  }

  renameTable(...args: Parameters<DraftApiService['apiRenameTable']>) {
    return this.draftApi.apiRenameTable(...args);
  }

  removeTable(...args: Parameters<DraftApiService['apiRemoveTable']>) {
    return this.draftApi.apiRemoveTable(...args);
  }

  getTable(...args: Parameters<TableApiService['getTable']>) {
    return this.tableApi.getTable(...args);
  }

  getTables(...args: Parameters<TableApiService['getTables']>) {
    return this.tableApi.getTables(...args);
  }

  getCountRowsInTable(
    ...args: Parameters<TableApiService['getCountRowsInTable']>
  ) {
    return this.tableApi.getCountRowsInTable(...args);
  }

  resolveTableSchema(
    ...args: Parameters<TableApiService['resolveTableSchema']>
  ) {
    return this.tableApi.resolveTableSchema(...args);
  }

  resolveTableForeignKeysBy(
    ...args: Parameters<TableApiService['resolveTableForeignKeysBy']>
  ) {
    return this.tableApi.resolveTableForeignKeysBy(...args);
  }

  resolveTableForeignKeysTo(
    ...args: Parameters<TableApiService['resolveTableForeignKeysTo']>
  ) {
    return this.tableApi.resolveTableForeignKeysTo(...args);
  }

  resolveTableCountForeignKeysBy(
    ...args: Parameters<TableApiService['resolveTableCountForeignKeysBy']>
  ) {
    return this.tableApi.resolveTableCountForeignKeysBy(...args);
  }

  resolveTableCountForeignKeysTo(
    ...args: Parameters<TableApiService['resolveTableCountForeignKeysTo']>
  ) {
    return this.tableApi.resolveTableCountForeignKeysTo(...args);
  }

  // --- Rows ---

  createRow(...args: Parameters<DraftApiService['apiCreateRow']>) {
    return this.draftApi.apiCreateRow(...args);
  }

  createRows(...args: Parameters<DraftApiService['apiCreateRows']>) {
    return this.draftApi.apiCreateRows(...args);
  }

  updateRow(...args: Parameters<DraftApiService['apiUpdateRow']>) {
    return this.draftApi.apiUpdateRow(...args);
  }

  updateRows(...args: Parameters<DraftApiService['apiUpdateRows']>) {
    return this.draftApi.apiUpdateRows(...args);
  }

  patchRow(...args: Parameters<DraftApiService['apiPatchRow']>) {
    return this.draftApi.apiPatchRow(...args);
  }

  patchRows(...args: Parameters<DraftApiService['apiPatchRows']>) {
    return this.draftApi.apiPatchRows(...args);
  }

  renameRow(...args: Parameters<DraftApiService['apiRenameRow']>) {
    return this.draftApi.apiRenameRow(...args);
  }

  removeRow(...args: Parameters<DraftApiService['apiRemoveRow']>) {
    return this.draftApi.apiRemoveRow(...args);
  }

  removeRows(...args: Parameters<DraftApiService['apiRemoveRows']>) {
    return this.draftApi.apiRemoveRows(...args);
  }

  getRow(...args: Parameters<RowApiService['getRow']>) {
    return this.rowApi.getRow(...args);
  }

  getRowById(...args: Parameters<RowApiService['getRowById']>) {
    return this.rowApi.getRowById(...args);
  }

  getRows(...args: Parameters<RowApiService['getRows']>) {
    return this.rowApi.getRows(...args);
  }

  searchRows(...args: Parameters<RowApiService['searchRows']>) {
    return this.rowApi.searchRows(...args);
  }

  resolveRowForeignKeysBy(
    ...args: Parameters<RowApiService['resolveRowForeignKeysBy']>
  ) {
    return this.rowApi.resolveRowForeignKeysBy(...args);
  }

  resolveRowForeignKeysTo(
    ...args: Parameters<RowApiService['resolveRowForeignKeysTo']>
  ) {
    return this.rowApi.resolveRowForeignKeysTo(...args);
  }

  resolveRowCountForeignKeysBy(
    ...args: Parameters<RowApiService['resolveRowCountForeignKeysBy']>
  ) {
    return this.rowApi.resolveRowCountForeignKeysBy(...args);
  }

  resolveRowCountForeignKeysTo(
    ...args: Parameters<RowApiService['resolveRowCountForeignKeysTo']>
  ) {
    return this.rowApi.resolveRowCountForeignKeysTo(...args);
  }

  // --- Revisions ---

  getRevision(...args: Parameters<RevisionsApiService['revision']>) {
    return this.revisionApi.revision(...args);
  }

  createRevision(...args: Parameters<DraftApiService['apiCreateRevision']>) {
    return this.draftApi.apiCreateRevision(...args);
  }

  revertChanges(data: ApiRevertChangesCommandData) {
    return this.commandBus.execute<
      ApiRevertChangesCommand,
      ApiRevertChangesCommandReturnType
    >(new ApiRevertChangesCommand(data));
  }

  getMigrations(...args: Parameters<RevisionsApiService['migrations']>) {
    return this.revisionApi.migrations(...args);
  }

  applyMigrations(...args: Parameters<DraftApiService['applyMigrations']>) {
    return this.draftApi.applyMigrations(...args);
  }

  getRevisionParent(
    ...args: Parameters<RevisionsApiService['resolveParentByRevision']>
  ) {
    return this.revisionApi.resolveParentByRevision(...args);
  }

  getRevisionChild(
    ...args: Parameters<RevisionsApiService['resolveChildByRevision']>
  ) {
    return this.revisionApi.resolveChildByRevision(...args);
  }

  getRevisionChildren(
    ...args: Parameters<RevisionsApiService['getChildrenByRevision']>
  ) {
    return this.revisionApi.getChildrenByRevision(...args);
  }

  getTablesByRevisionId(
    ...args: Parameters<RevisionsApiService['getTablesByRevisionId']>
  ) {
    return this.revisionApi.getTablesByRevisionId(...args);
  }

  resolveChildBranchesByRevision(
    ...args: Parameters<RevisionsApiService['resolveChildBranchesByRevision']>
  ) {
    return this.revisionApi.resolveChildBranchesByRevision(...args);
  }

  resolveBranchByRevision(
    ...args: Parameters<RevisionsApiService['resolveBranchByRevision']>
  ) {
    return this.revisionApi.resolveBranchByRevision(...args);
  }

  // --- Revision Changes ---

  revisionChanges(
    ...args: Parameters<RevisionChangesApiService['revisionChanges']>
  ) {
    return this.changesApi.revisionChanges(...args);
  }

  tableChanges(...args: Parameters<RevisionChangesApiService['tableChanges']>) {
    return this.changesApi.tableChanges(...args);
  }

  rowChanges(...args: Parameters<RevisionChangesApiService['rowChanges']>) {
    return this.changesApi.rowChanges(...args);
  }

  // --- Branches ---

  getBranch(...args: Parameters<BranchApiService['getBranch']>) {
    return this.branchApi.getBranch(...args);
  }

  getBranchById(...args: Parameters<BranchApiService['getBranchById']>) {
    return this.branchApi.getBranchById(...args);
  }

  getBranches(...args: Parameters<BranchApiService['getBranches']>) {
    return this.branchApi.getBranches(...args);
  }

  createBranch(
    ...args: Parameters<BranchApiService['apiCreateBranchByRevisionId']>
  ) {
    return this.branchApi.apiCreateBranchByRevisionId(...args);
  }

  deleteBranch(...args: Parameters<BranchApiService['deleteBranch']>) {
    return this.branchApi.deleteBranch(...args);
  }

  getHeadRevision(...args: Parameters<BranchApiService['getHeadRevision']>) {
    return this.branchApi.getHeadRevision(...args);
  }

  getDraftRevision(...args: Parameters<BranchApiService['getDraftRevision']>) {
    return this.branchApi.getDraftRevision(...args);
  }

  getStartRevision(...args: Parameters<BranchApiService['getStartRevision']>) {
    return this.branchApi.getStartRevision(...args);
  }

  getRevisionsByBranchId(
    ...args: Parameters<BranchApiService['getRevisionsByBranchId']>
  ) {
    return this.branchApi.getRevisionsByBranchId(...args);
  }

  getTouchedByBranchId(
    ...args: Parameters<BranchApiService['getTouchedByBranchId']>
  ) {
    return this.branchApi.getTouchedByBranchId(...args);
  }

  resolveParentBranch(
    ...args: Parameters<BranchApiService['resolveParentBranch']>
  ) {
    return this.branchApi.resolveParentBranch(...args);
  }

  getProjectByBranch(
    ...args: Parameters<BranchApiService['getProjectByBranch']>
  ) {
    return this.branchApi.getProjectByBranch(...args);
  }

  // --- Files ---

  uploadFile(...args: Parameters<DraftApiService['apiUploadFile']>) {
    return this.draftApi.apiUploadFile(...args);
  }

  // --- Views ---

  getTableViews(...args: Parameters<ViewsApiService['getTableViews']>) {
    return this.viewsApi.getTableViews(...args);
  }

  updateTableViews(...args: Parameters<ViewsApiService['updateTableViews']>) {
    return this.viewsApi.updateTableViews(...args);
  }

  // --- Sub-Schema ---

  getSubSchemaItems(
    ...args: Parameters<SubSchemaApiService['getSubSchemaItems']>
  ) {
    return this.subSchemaApi.getSubSchemaItems(...args);
  }

  // --- Cleanup ---

  cleanOrphanedData() {
    return this.cleanupService.cleanOrphanedData();
  }

  // --- Migrations ---

  getMigrationStatus(
    ...args: Parameters<MigrationApiService['getMigrationStatus']>
  ) {
    return this.migrationApi.getMigrationStatus(...args);
  }

  getActiveMigrations(
    ...args: Parameters<MigrationApiService['getActiveMigrations']>
  ) {
    return this.migrationApi.getActiveMigrations(...args);
  }

  abortMigration(...args: Parameters<MigrationApiService['abortMigration']>) {
    return this.migrationApi.abortMigration(...args);
  }
}
