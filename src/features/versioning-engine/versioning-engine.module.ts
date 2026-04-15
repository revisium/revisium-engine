import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { BranchModule } from 'src/features/branch/branch.module';
import { DraftModule } from 'src/features/draft/draft.module';
import { RowModule } from 'src/features/row/row.module';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
import { CowVersioningEngineService } from 'src/features/versioning-engine/services/cow-versioning-engine.service';
import { CurrentVersioningEngineService } from 'src/features/versioning-engine/services/current-versioning-engine.service';
import { ProjectVersioningService } from 'src/features/versioning-engine/services/project-versioning.service';
import { VersioningEngineService } from 'src/features/versioning-engine/services/versioning-engine.service';

@Module({
  imports: [CqrsModule, DatabaseModule, BranchModule, DraftModule, RowModule],
  providers: [
    ProjectVersioningService,
    CurrentVersioningEngineService,
    CowVersioningEngineService,
    VersioningEngineService,
  ],
  exports: [ProjectVersioningService, VersioningEngineService],
})
export class VersioningEngineModule {}
