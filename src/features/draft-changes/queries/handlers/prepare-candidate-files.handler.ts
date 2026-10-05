import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { PrepareCandidateFilesQuery } from 'src/features/draft-changes/queries/impl/prepare-candidate-files.query';
import type { PrepareCandidateFilesResult } from 'src/features/draft-changes/queries/impl/prepare-candidate-files.query';
import { FileUsageApiService } from 'src/features/file-usage/file-usage-api.service';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import { prepareCandidateFiles } from 'src/features/draft-changes/files/prepare-candidate-files';
import { FileReferenceExtractorService } from 'src/features/file-usage/services/file-reference-extractor.service';

@QueryHandler(PrepareCandidateFilesQuery)
export class PrepareCandidateFilesHandler implements IQueryHandler<
  PrepareCandidateFilesQuery,
  PrepareCandidateFilesResult
> {
  constructor(
    private readonly fileUsage: FileUsageApiService,
    private readonly validator: JsonSchemaValidatorService,
    private readonly extractor: FileReferenceExtractorService,
  ) {}

  async execute(
    query: PrepareCandidateFilesQuery,
  ): Promise<PrepareCandidateFilesResult> {
    return this.handle(query.data);
  }

  private handle(
    data: PrepareCandidateFilesQuery['data'],
  ): Promise<PrepareCandidateFilesResult> {
    return prepareCandidateFiles(
      data,
      this.fileUsage,
      this.validator,
      this.extractor,
    );
  }
}
