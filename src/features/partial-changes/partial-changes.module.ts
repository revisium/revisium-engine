import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { DraftRevisionModule } from 'src/features/draft-revision/draft-revision.module';
import { DraftModule } from 'src/features/draft/draft.module';
import { RowMerger } from 'src/features/partial-changes/assembly/row-merger';
import { TargetAssembler } from 'src/features/partial-changes/assembly/target-assembler';
import { DependencyClosure } from 'src/features/partial-changes/closure/dependency-closure';
import { DraftChangesSummaryReader } from 'src/features/partial-changes/draft-reads/draft-changes-summary';
import { DraftRowItems } from 'src/features/partial-changes/draft-reads/draft-row-items';
import { DraftRowPages } from 'src/features/partial-changes/draft-reads/draft-row-pages';
import { DraftTableItems } from 'src/features/partial-changes/draft-reads/draft-table-items';
import { DraftTablePages } from 'src/features/partial-changes/draft-reads/draft-table-pages';
import { DraftTablesReader } from 'src/features/partial-changes/draft-reads/draft-tables';
import { ReportedRowCountsReader } from 'src/features/partial-changes/draft-reads/reported-row-counts-reader';
import { ReportedRowPairsReader } from 'src/features/partial-changes/draft-reads/reported-row-pairs-reader';
import { PageRenamesReader } from 'src/features/partial-changes/draft-reads/page-renames';
import type { TargetCheck } from 'src/features/partial-changes/closure/check-context';
import {
  TARGET_CHECKS,
  TARGET_CHECKS_IN_SPEC_ORDER,
} from 'src/features/partial-changes/closure/target-checks';
import { PARTIAL_CHANGES_COMMAND_HANDLERS } from 'src/features/partial-changes/commands/handlers';
import { OperationEstimator } from 'src/features/partial-changes/limits/operation-estimator';
import { PartialChangesLimits } from 'src/features/partial-changes/limits/partial-changes-limits';
import { UnitListing } from 'src/features/partial-changes/listing/unit-listing';
import { PartialOperationLog } from 'src/features/partial-changes/logging/partial-operation-log';
import { PartialChangesApiService } from 'src/features/partial-changes/partial-changes-api.service';
import { ChangePlanner } from 'src/features/partial-changes/planning/change-planner';
import { PlanFingerprint } from 'src/features/partial-changes/planning/plan-fingerprint';
import { PARTIAL_CHANGES_QUERY_HANDLERS } from 'src/features/partial-changes/queries/handlers';
import { ReadScope } from 'src/features/partial-changes/scope/read-scope';
import { ScopedCatalogueReader } from 'src/features/partial-changes/scope/scoped-catalogue-reader.service';
import { ChangesSnapshotReader } from 'src/features/partial-changes/snapshot/changes-snapshot-reader.service';
import { ComparedSnapshotReader } from 'src/features/partial-changes/snapshot/compared-snapshot-reader.service';
import { TargetValidator } from 'src/features/partial-changes/validation/target-validator';
import { ChangeApplier } from 'src/features/partial-changes/writing/change-applier';
import { PluginModule } from 'src/features/plugin/plugin.module';
import { RevisionChangesModule } from 'src/features/revision-changes/revision-changes.module';
import { ShareModule } from 'src/features/share/share.module';
import { ViewsModule } from 'src/features/views/views.module';
import { DatabaseModule } from 'src/infrastructure/database/database.module';

@Module({
  imports: [
    DatabaseModule,
    CqrsModule,
    ShareModule,
    PluginModule,
    ViewsModule,
    DraftRevisionModule,
    DraftModule,
    RevisionChangesModule,
  ],
  providers: [
    ChangesSnapshotReader,
    ComparedSnapshotReader,
    ReadScope,
    PartialChangesLimits,
    ScopedCatalogueReader,
    RowMerger,
    TargetAssembler,
    OperationEstimator,
    ...TARGET_CHECKS_IN_SPEC_ORDER,
    {
      provide: TARGET_CHECKS,
      useFactory: (...checks: TargetCheck[]) => checks,
      inject: TARGET_CHECKS_IN_SPEC_ORDER,
    },
    DependencyClosure,
    TargetValidator,
    PlanFingerprint,
    ChangePlanner,
    PartialOperationLog,
    ChangeApplier,
    UnitListing,
    ReportedRowCountsReader,
    DraftTablesReader,
    DraftTableItems,
    DraftTablePages,
    ReportedRowPairsReader,
    PageRenamesReader,
    DraftRowItems,
    DraftRowPages,
    DraftChangesSummaryReader,
    PartialChangesApiService,
    ...PARTIAL_CHANGES_QUERY_HANDLERS,
    ...PARTIAL_CHANGES_COMMAND_HANDLERS,
  ],
})
export class PartialChangesModule {}
