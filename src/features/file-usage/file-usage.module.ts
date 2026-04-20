import { Global, Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
import { ShareModule } from 'src/features/share/share.module';
import { FileReferenceExtractorService } from 'src/features/file-usage/services/file-reference-extractor.service';
import { FileUsageIntegrationService } from 'src/features/file-usage/services/file-usage-integration.service';
import { FileUsageApiService } from 'src/features/file-usage/file-usage-api.service';
import { FILE_USAGE_COMMAND_HANDLERS } from 'src/features/file-usage/commands/handlers';
import { FILE_USAGE_QUERY_HANDLERS } from 'src/features/file-usage/queries/handlers';

const SERVICES = [
  FileReferenceExtractorService,
  FileUsageIntegrationService,
  FileUsageApiService,
];

@Global()
@Module({
  imports: [DatabaseModule, CqrsModule, ShareModule],
  providers: [
    ...SERVICES,
    ...FILE_USAGE_COMMAND_HANDLERS,
    ...FILE_USAGE_QUERY_HANDLERS,
  ],
  exports: SERVICES,
})
export class FileUsageModule {}
