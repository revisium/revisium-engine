import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import {
  ReadDraftChangedRowsQuery,
  type ReadDraftChangedRowsResult,
} from 'src/features/draft-changes/queries/impl/read-draft-changed-rows.query';
import { DraftChangesReadContext } from 'src/features/draft-changes/reading/read-context';
import { requireTableBinding } from 'src/features/draft-changes/reading/entity-identity';
import { readChangedRows } from 'src/features/draft-changes/reading/row-reads';

@QueryHandler(ReadDraftChangedRowsQuery)
export class ReadDraftChangedRowsHandler implements IQueryHandler<
  ReadDraftChangedRowsQuery,
  ReadDraftChangedRowsResult
> {
  constructor(private readonly readContext: DraftChangesReadContext) {}

  async execute(
    query: ReadDraftChangedRowsQuery,
  ): Promise<ReadDraftChangedRowsResult> {
    return this.readRows(query);
  }

  private async readRows(
    query: ReadDraftChangedRowsQuery,
  ): Promise<ReadDraftChangedRowsResult> {
    const { catalogue } = await this.readContext.prepare(query.data);
    const table = requireTableBinding(catalogue, query.data.tableId);
    return readChangedRows(catalogue, table, query.data.page);
  }
}
