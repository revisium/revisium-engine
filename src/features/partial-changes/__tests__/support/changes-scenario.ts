import {
  BranchScenario,
  type TableFixture,
} from 'src/__tests__/fixtures/branch-scenario';
import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import { BranchApiService } from 'src/features/branch/branch-api.service';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type {
  ListChangesResult,
  ListedUnit,
} from 'src/features/partial-changes/queries/impl/list-draft-changes.query';
import type { CommitChangesResult } from 'src/features/partial-changes/commands/impl/commit-draft-changes.command';
import type { DraftChangesSummary } from 'src/features/partial-changes/queries/impl/get-draft-changes-summary.query';
import type { DraftTablePage } from 'src/features/partial-changes/queries/impl/get-draft-table-changes.query';
import type { RevertChangesResult } from 'src/features/partial-changes/commands/impl/revert-draft-changes.command';
import type { PreviewChangesResult } from 'src/features/partial-changes/queries/impl/preview-draft-changes.query';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import type { ChangesSnapshot } from 'src/features/partial-changes/snapshot/changes-snapshot';
import type {
  RevisionChanges,
  TableChange,
} from 'src/features/revision-changes/types';
import {
  type CatalogueView,
  readCatalogue,
  readWholeDraftCatalogue,
} from './catalogue-reading';
import { commitChanges, type CommitOptions } from './change-committing';
import {
  listChanges,
  listEveryPage,
  listEveryPageWithReads,
  type ListingOptions,
  type PageWithReads,
  unitsOfPages,
} from './change-listing';
import { previewChanges, type PreviewOptions } from './change-preview';
import { revertChanges, type RevertOptions } from './change-reverting';
import { type ClosureView, readClosedDependencies } from './dependency-closing';
import {
  type DraftSummaryOptions,
  type DraftTableOptions,
  type DraftTablePaging,
  linkSetsOf,
  type NativeComparison,
  type NativeTableFilters,
  readDraftChangesSummary,
  readDraftTableChanges,
  readEveryDraftTablePage,
  readNativeSummary,
  readNativeTableChanges,
  type TableLinkSets,
} from './draft-reading';
import {
  type FileAccounting,
  readFileAccounting,
  readFileReferences,
} from './file-accounting';
import { type PlanVariant, readPlanFingerprint } from './plan-fingerprinting';
import {
  readScopedCatalogue,
  type ScopedCatalogueView,
} from './scoped-reading';
import {
  type BlockerView,
  readSelectionResolution,
  type ResolutionView,
} from './selection-resolving';
import { readAssembledTarget, type TargetView } from './target-assembling';
import { readValidationBlockers } from './target-validating';
import {
  type ChangedRowsView,
  readChangedRows,
  readInPlanningTransaction,
} from './snapshot-reading';

export class ChangesScenario extends BranchScenario {
  declare protected readonly kit: PartialChangesTestKit;

  public static async committed(
    kit: PartialChangesTestKit,
    tables: Readonly<Record<string, TableFixture>>,
  ): Promise<ChangesScenario> {
    return ChangesScenario.over(
      kit,
      await BranchScenario.committed(kit, tables),
    );
  }

  public static async committedWithoutLedger(
    kit: PartialChangesTestKit,
    tables: Readonly<Record<string, TableFixture>>,
  ): Promise<ChangesScenario> {
    return ChangesScenario.over(
      kit,
      await BranchScenario.committedWithoutLedger(kit, tables),
    );
  }

  private static over(
    kit: PartialChangesTestKit,
    { branch, branchId }: BranchScenario,
  ): ChangesScenario {
    return new ChangesScenario(kit, branch, branchId);
  }

  public async branchFromHead(branchName: string): Promise<ChangesScenario> {
    const branch = await this.kit.module
      .get(BranchApiService)
      .apiCreateBranchByRevisionId({
        revisionId: await this.revisionId('head'),
        branchName,
      });
    const twin = new ChangesScenario(
      this.kit,
      { projectId: this.branch.projectId, branchName: branch.name },
      branch.id,
    );

    await twin.observeCommittedVersions();

    return twin;
  }

  public readSnapshot(): Promise<ChangesSnapshot> {
    return readInPlanningTransaction(this.kit, () =>
      this.kit.snapshotReader.readSnapshot(this.branch),
    );
  }

  public readChangedRows(
    tableIds: readonly string[],
  ): Promise<ChangedRowsView> {
    return readChangedRows(this.kit, this.branch, tableIds);
  }

  public readCatalogue(tableIds: readonly string[]): Promise<CatalogueView> {
    return readCatalogue(this.kit, this.branch, tableIds);
  }

  public readWholeDraftCatalogue(): Promise<CatalogueView> {
    return readWholeDraftCatalogue(this.kit, this.branch);
  }

  public readScopedCatalogue(
    selection: Selection,
  ): Promise<ScopedCatalogueView> {
    return readScopedCatalogue(this.kit, this.branch, selection);
  }

  public resolveSelection(selection: Selection): Promise<ResolutionView> {
    return readSelectionResolution(this.kit, this.branch, selection);
  }

  public listChanges(options: ListingOptions = {}): Promise<ListChangesResult> {
    return listChanges(this.kit, this.branch, options);
  }

  public listEveryPage(options: ListingOptions): Promise<ListChangesResult[]> {
    return listEveryPage(this.kit, this.branch, options);
  }

  public async listEveryUnit(): Promise<ListedUnit[]> {
    return unitsOfPages(await this.listEveryPage({}));
  }

  public listEveryPageWithReads(
    options: ListingOptions,
  ): Promise<PageWithReads[]> {
    return listEveryPageWithReads(this.kit, this.branch, options);
  }

  public readDraftTableChanges(
    options: DraftTableOptions,
  ): Promise<DraftTablePage> {
    return readDraftTableChanges(this.kit, this.branch, options);
  }

  public readEveryDraftTablePage(
    paging: DraftTablePaging,
  ): Promise<DraftTablePage[]> {
    return readEveryDraftTablePage(this.kit, this.branch, paging);
  }

  public readDraftChangesSummary(
    options: DraftSummaryOptions = {},
  ): Promise<DraftChangesSummary> {
    return readDraftChangesSummary(this.kit, this.branch, options);
  }

  public async readNativeTableChanges(
    filters: NativeTableFilters = {},
  ): Promise<TableChange[]> {
    return readNativeTableChanges(
      this.kit,
      await this.nativeComparison(),
      filters,
    );
  }

  public async readNativeSummary(): Promise<RevisionChanges> {
    return readNativeSummary(this.kit, await this.nativeComparison());
  }

  public linkSetsOf(tableIds: readonly string[]): Promise<TableLinkSets[]> {
    return linkSetsOf(this, tableIds);
  }

  public previewChanges(
    options: PreviewOptions,
  ): Promise<PreviewChangesResult> {
    return previewChanges(this.kit, this.branch, options);
  }

  public async commitChanges(
    options: CommitOptions,
  ): Promise<CommitChangesResult> {
    const result = await commitChanges(this.kit, this.branch, options);
    await this.observeCommittedVersions();

    return result;
  }

  public revertChanges(options: RevertOptions): Promise<RevertChangesResult> {
    return revertChanges(this.kit, this.branch, options);
  }

  public assembleTarget(
    operation: ChangeOperation,
    selection: Selection,
  ): Promise<TargetView> {
    return readAssembledTarget(this.kit, this.branch, operation, selection);
  }

  public closeDependencies(
    operation: ChangeOperation,
    selection: Selection,
  ): Promise<ClosureView> {
    return readClosedDependencies(this.kit, this.branch, operation, selection);
  }

  public validateTarget(
    operation: ChangeOperation,
    selection: Selection,
  ): Promise<BlockerView[]> {
    return readValidationBlockers(this.kit, this.branch, operation, selection);
  }

  public fingerprintPlan(
    operation: ChangeOperation,
    selection: Selection,
    variant?: PlanVariant,
  ): Promise<string> {
    return readPlanFingerprint(
      this.kit,
      this.branch,
      operation,
      selection,
      variant,
    );
  }

  public readFileAccounting(): Promise<FileAccounting> {
    return readFileAccounting(this.kit, this);
  }

  public readFileReferences(): Promise<string[]> {
    return readFileReferences(this.kit, this);
  }

  private async nativeComparison(): Promise<NativeComparison> {
    return {
      revisionId: await this.revisionId('draft'),
      compareWithRevisionId: await this.revisionId('head'),
    };
  }

  public async readDraftRowDigest(tableId: string): Promise<string> {
    const tableVersionId = await this.tableVersionId('draft', tableId);

    return readInPlanningTransaction(this.kit, () =>
      this.kit.snapshotReader.readRowDigest(tableVersionId),
    );
  }
}
