import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { RowMerger } from 'src/features/partial-changes-poc/assembly/row-merger.service';
import { TargetAssembler } from 'src/features/partial-changes-poc/assembly/target-assembler.service';
import { CommitChangesHandler } from 'src/features/partial-changes-poc/commands/handlers/commit-changes.handler';
import { RevertPartialChangesHandler } from 'src/features/partial-changes-poc/commands/handlers/revert-changes.handler';
import { DependencyClosure } from 'src/features/partial-changes-poc/dependencies/dependency-closure.service';
import { RowLookup } from 'src/features/partial-changes-poc/dependencies/row-lookup.service';
import { StructureConsistencyChecks } from 'src/features/partial-changes-poc/dependencies/structure-consistency-checks.service';
import { TargetConsistencyChecks } from 'src/features/partial-changes-poc/dependencies/target-consistency-checks.service';
import { PartialChangesApiService } from 'src/features/partial-changes-poc/partial-changes-api.service';
import { ChangePlanner } from 'src/features/partial-changes-poc/planning/change-planner.service';
import { TargetValidator } from 'src/features/partial-changes-poc/planning/target-validator.service';
import { PreviewChangesHandler } from 'src/features/partial-changes-poc/queries/handlers/preview-changes.handler';
import { SnapshotReader } from 'src/features/partial-changes-poc/snapshot/snapshot-reader.service';
import { ViewsProjection } from 'src/features/partial-changes-poc/views/views-projection.service';
import { CommitWriter } from 'src/features/partial-changes-poc/write/commit-writer.service';
import { RevertWriter } from 'src/features/partial-changes-poc/write/revert-writer.service';
import { VersionWriter } from 'src/features/partial-changes-poc/write/version-writer.service';
import { FileUsageModule } from 'src/features/file-usage/file-usage.module';
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
    FileUsageModule,
  ],
  providers: [
    PartialChangesApiService,
    PreviewChangesHandler,
    CommitChangesHandler,
    RevertPartialChangesHandler,
    SnapshotReader,
    ChangePlanner,
    TargetAssembler,
    RowMerger,
    DependencyClosure,
    TargetConsistencyChecks,
    StructureConsistencyChecks,
    RowLookup,
    TargetValidator,
    ViewsProjection,
    VersionWriter,
    CommitWriter,
    RevertWriter,
  ],
  exports: [PartialChangesApiService],
})
export class PartialChangesPocModule {}
