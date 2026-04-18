import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { BranchModule } from 'src/features/branch/branch.module';
import { DraftModule } from 'src/features/draft/draft.module';
import { PluginModule } from 'src/features/plugin/plugin.module';
import { RowModule } from 'src/features/row/row.module';
import { ShareModule } from 'src/features/share/share.module';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
import { CowVersioningEngineService } from 'src/features/versioning-engine/services/cow-versioning-engine.service';
import { CowVersioningStateService } from 'src/features/versioning-engine/services/cow-versioning-state.service';
import { CurrentVersioningEngineService } from 'src/features/versioning-engine/services/current-versioning-engine.service';
import { ProjectVersioningService } from 'src/features/versioning-engine/services/project-versioning.service';
import { VersioningEngineService } from 'src/features/versioning-engine/services/versioning-engine.service';

@Module({
  imports: [
    CqrsModule,
    DatabaseModule,
    ShareModule,
    PluginModule,
    BranchModule,
    DraftModule,
    RowModule,
  ],
  providers: [
    ProjectVersioningService,
    CurrentVersioningEngineService,
    CowVersioningEngineService,
    CowVersioningStateService,
    VersioningEngineService,
  ],
  exports: [ProjectVersioningService, VersioningEngineService],
})
export class VersioningEngineModule {}
