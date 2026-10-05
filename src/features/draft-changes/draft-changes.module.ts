import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
import { DRAFT_CHANGES_QUERY_HANDLERS } from 'src/features/draft-changes/queries/handlers';
import { DraftChangesApiService } from 'src/features/draft-changes/draft-changes-api.service';
import { RevisionChangesModule } from 'src/features/revision-changes/revision-changes.module';
import { ShareModule } from 'src/features/share/share.module';
import { PluginModule } from 'src/features/plugin/plugin.module';
import { ViewsModule } from 'src/features/views/views.module';
import { FileUsageModule } from 'src/features/file-usage/file-usage.module';
import { DRAFT_CHANGES_COMMAND_HANDLERS } from 'src/features/draft-changes/commands/handlers';
import { DraftChangesReadContext } from 'src/features/draft-changes/reading/read-context';
import { DraftChangesReadProjection } from 'src/features/draft-changes/reading/projection/draft-changes-read-projection';

@Module({
  imports: [
    CqrsModule,
    DatabaseModule,
    RevisionChangesModule,
    ShareModule,
    PluginModule,
    FileUsageModule,
    ViewsModule,
  ],
  providers: [
    DraftChangesApiService,
    DraftChangesReadContext,
    DraftChangesReadProjection,
    ...DRAFT_CHANGES_QUERY_HANDLERS,
    ...DRAFT_CHANGES_COMMAND_HANDLERS,
  ],
  exports: [DraftChangesApiService],
})
export class DraftChangesModule {}
