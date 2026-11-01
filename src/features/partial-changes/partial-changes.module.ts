import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { DraftRevisionModule } from 'src/features/draft-revision/draft-revision.module';
import { DraftModule } from 'src/features/draft/draft.module';
import { RowMerger } from 'src/features/partial-changes/assembly/row-merger';
import { SystemTargetAssembler } from 'src/features/partial-changes/assembly/system-target-assembler';
import { TargetAssembler } from 'src/features/partial-changes/assembly/target-assembler';
import { HeadViewsMigration } from 'src/features/partial-changes/catalogue/head-views-migration';
import { DependencyClosure } from 'src/features/partial-changes/closure/dependency-closure';
import type { TargetCheck } from 'src/features/partial-changes/closure/check-context';
import {
  TARGET_CHECKS,
  TARGET_CHECKS_IN_SPEC_ORDER,
} from 'src/features/partial-changes/closure/target-checks';
import { PARTIAL_CHANGES_COMMAND_HANDLERS } from 'src/features/partial-changes/commands/handlers';
import { OperationEstimator } from 'src/features/partial-changes/limits/operation-estimator';
import { PartialChangesLimits } from 'src/features/partial-changes/limits/partial-changes-limits';
import { UnitListing } from 'src/features/partial-changes/listing/unit-listing';
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
  ],
  providers: [
    ChangesSnapshotReader,
    ComparedSnapshotReader,
    HeadViewsMigration,
    ReadScope,
    PartialChangesLimits,
    ScopedCatalogueReader,
    RowMerger,
    SystemTargetAssembler,
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
    ChangeApplier,
    UnitListing,
    PartialChangesApiService,
    ...PARTIAL_CHANGES_QUERY_HANDLERS,
    ...PARTIAL_CHANGES_COMMAND_HANDLERS,
  ],
})
export class PartialChangesModule {}
