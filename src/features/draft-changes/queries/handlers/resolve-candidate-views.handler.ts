import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { ViewsMigrationService } from 'src/features/share/views-migration.service';
import { ViewValidationService } from 'src/features/views/services/view-validation.service';
import {
  ResolveCandidateViewsQuery,
  type ResolveCandidateViewsQueryData,
  type ResolveCandidateViewsResult,
} from 'src/features/draft-changes/queries/impl/resolve-candidate-views.query';
import { resolveCandidateViewState } from 'src/features/draft-changes/views/resolve-candidate-view-state';

@QueryHandler(ResolveCandidateViewsQuery)
export class ResolveCandidateViewsHandler implements IQueryHandler<
  ResolveCandidateViewsQuery,
  ResolveCandidateViewsResult
> {
  constructor(
    private readonly viewsMigrationService: ViewsMigrationService,
    private readonly viewValidation: ViewValidationService,
  ) {}

  async execute(
    query: ResolveCandidateViewsQuery,
  ): Promise<ResolveCandidateViewsResult> {
    return this.handle(query.data);
  }

  private handle(
    data: ResolveCandidateViewsQueryData,
  ): Promise<ResolveCandidateViewsResult> {
    return resolveCandidateViewState(
      data,
      this.viewsMigrationService,
      this.viewValidation,
    );
  }
}
