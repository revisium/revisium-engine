import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import {
  ReadDraftChangedTablesQuery,
  type ReadDraftChangedTablesResult,
} from 'src/features/draft-changes/queries/impl/read-draft-changed-tables.query';
import { DraftChangesReadContext } from 'src/features/draft-changes/reading/read-context';
import { readChangedTables } from 'src/features/draft-changes/reading/table-reads';

@QueryHandler(ReadDraftChangedTablesQuery)
export class ReadDraftChangedTablesHandler implements IQueryHandler<
  ReadDraftChangedTablesQuery,
  ReadDraftChangedTablesResult
> {
  constructor(private readonly readContext: DraftChangesReadContext) {}

  async execute(
    query: ReadDraftChangedTablesQuery,
  ): Promise<ReadDraftChangedTablesResult> {
    return this.readTables(query);
  }

  private async readTables(
    query: ReadDraftChangedTablesQuery,
  ): Promise<ReadDraftChangedTablesResult> {
    const { catalogue } = await this.readContext.prepare(query.data);
    return readChangedTables(catalogue, query.data.page);
  }
}
