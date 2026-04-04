import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
import { ShareModule } from 'src/features/share/share.module';
import { PluginModule } from 'src/features/plugin/plugin.module';
import { StorageModule } from 'src/infrastructure/storage/storage.module';
import { RevisionModule } from 'src/features/revision/revision.module';
import { BranchModule } from 'src/features/branch/branch.module';
import { TableModule } from 'src/features/table/table.module';
import { RowModule } from 'src/features/row/row.module';
import { DraftRevisionModule } from 'src/features/draft-revision/draft-revision.module';
import { DraftModule } from 'src/features/draft/draft.module';
import { RevisionChangesModule } from 'src/features/revision-changes/revision-changes.module';
import { SubSchemaModule } from 'src/features/sub-schema/sub-schema.module';
import { ViewsModule } from 'src/features/views/views.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    StorageModule,
    ShareModule,
    PluginModule,
    RevisionModule,
    BranchModule,
    TableModule,
    RowModule,
    DraftRevisionModule,
    DraftModule,
    RevisionChangesModule,
    SubSchemaModule,
    ViewsModule,
  ],
})
export class AppModule {}
