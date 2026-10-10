import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import {
  ReadDraftChangesQuery,
  type ReadDraftChangesResult,
} from 'src/features/draft-changes/queries/impl/read-draft-changes.query';
import { DraftChangesReadContext } from 'src/features/draft-changes/reading/read-context';
import { summarizeCatalogue } from 'src/features/draft-changes/reading/summary';

@QueryHandler(ReadDraftChangesQuery)
export class ReadDraftChangesHandler implements IQueryHandler<
  ReadDraftChangesQuery,
  ReadDraftChangesResult
> {
  constructor(private readonly readContext: DraftChangesReadContext) {}

  async execute(query: ReadDraftChangesQuery): Promise<ReadDraftChangesResult> {
    return this.readSummary(query);
  }

  private async readSummary(
    query: ReadDraftChangesQuery,
  ): Promise<ReadDraftChangesResult> {
    const { catalogue } = await this.readContext.prepare(query.data);
    return summarizeCatalogue(catalogue);
  }
}
