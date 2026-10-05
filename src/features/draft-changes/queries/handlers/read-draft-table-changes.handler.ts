import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import {
  ReadDraftTableChangesQuery,
  type ReadDraftTableChangesResult,
} from 'src/features/draft-changes/queries/impl/read-draft-table-changes.query';
import { DraftChangesReadContext } from 'src/features/draft-changes/reading/read-context';
import { readTableDetails } from 'src/features/draft-changes/reading/table-reads';

@QueryHandler(ReadDraftTableChangesQuery)
export class ReadDraftTableChangesHandler implements IQueryHandler<
  ReadDraftTableChangesQuery,
  ReadDraftTableChangesResult
> {
  constructor(private readonly readContext: DraftChangesReadContext) {}

  async execute(
    query: ReadDraftTableChangesQuery,
  ): Promise<ReadDraftTableChangesResult> {
    return this.readTable(query);
  }

  private async readTable(
    query: ReadDraftTableChangesQuery,
  ): Promise<ReadDraftTableChangesResult> {
    const { catalogue } = await this.readContext.prepare(query.data);
    return readTableDetails(catalogue, query.data.tableId);
  }
}
