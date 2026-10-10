import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import {
  ReadDraftRowChangesQuery,
  type ReadDraftRowChangesResult,
} from 'src/features/draft-changes/queries/impl/read-draft-row-changes.query';
import { DraftChangesReadContext } from 'src/features/draft-changes/reading/read-context';
import {
  requireRowBinding,
  requireTableBinding,
} from 'src/features/draft-changes/reading/entity-identity';
import { readRowDetails } from 'src/features/draft-changes/reading/row-reads';

@QueryHandler(ReadDraftRowChangesQuery)
export class ReadDraftRowChangesHandler implements IQueryHandler<
  ReadDraftRowChangesQuery,
  ReadDraftRowChangesResult
> {
  constructor(private readonly readContext: DraftChangesReadContext) {}

  async execute(
    query: ReadDraftRowChangesQuery,
  ): Promise<ReadDraftRowChangesResult> {
    return this.readRow(query);
  }

  private async readRow(
    query: ReadDraftRowChangesQuery,
  ): Promise<ReadDraftRowChangesResult> {
    const { catalogue } = await this.readContext.prepare(query.data);
    const table = requireTableBinding(catalogue, query.data.tableId);
    const row = requireRowBinding(
      catalogue,
      table.entityCreatedId,
      query.data.rowId,
    );
    return readRowDetails(catalogue, table, row, query.data.page);
  }
}
