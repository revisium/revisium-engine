import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { PluginModule } from 'src/features/plugin/plugin.module';
import { InternalRowApiService } from 'src/features/row/internal-row-api.service';
import { ROW_QUERIES_HANDLERS } from 'src/features/row/queries/handlers';
import { RowApiService } from 'src/features/row/row-api.service';
import { SystemColumnMappingService } from 'src/features/row/services';
import { PreviousRowStatesReader } from 'src/features/row/services/previous-row-states.reader';
import { PreviousRowStatesService } from 'src/features/row/services/previous-row-states.service';
import { ShareModule } from 'src/features/share/share.module';
import { DatabaseModule } from 'src/infrastructure/database/database.module';

@Module({
  imports: [DatabaseModule, CqrsModule, ShareModule, PluginModule],
  providers: [
    InternalRowApiService,
    RowApiService,
    SystemColumnMappingService,
    PreviousRowStatesReader,
    PreviousRowStatesService,
    ...ROW_QUERIES_HANDLERS,
  ],
  exports: [RowApiService, SystemColumnMappingService],
})
export class RowModule {}
