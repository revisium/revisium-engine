import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
import { DRAFT_CHANGES_QUERY_HANDLERS } from 'src/features/draft-changes/queries/handlers';
import { DraftChangesApiService } from 'src/features/draft-changes/draft-changes-api.service';
import { RevisionChangesModule } from 'src/features/revision-changes/revision-changes.module';
import { ShareModule } from 'src/features/share/share.module';

@Module({
  imports: [CqrsModule, DatabaseModule, RevisionChangesModule, ShareModule],
  providers: [DraftChangesApiService, ...DRAFT_CHANGES_QUERY_HANDLERS],
  exports: [DraftChangesApiService],
})
export class DraftChangesModule {}
