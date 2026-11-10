import { Injectable } from '@nestjs/common';
import { compareTablePositions } from 'src/features/partial-changes/draft-reads/draft-cursor';
import type { DraftTableChangesRequest } from 'src/features/partial-changes/draft-reads/draft-read-request';
import { DraftTableItems } from 'src/features/partial-changes/draft-reads/draft-table-items';
import { DraftTablesReader } from 'src/features/partial-changes/draft-reads/draft-tables';
import type { DraftTablePage } from 'src/features/partial-changes/queries/impl/get-draft-table-changes.query';

@Injectable()
export class DraftTablePages {
  constructor(
    private readonly tablesReader: DraftTablesReader,
    private readonly tableItems: DraftTableItems,
  ) {}

  public async readPage({
    branch,
    first,
    after,
    filters,
  }: DraftTableChangesRequest): Promise<DraftTablePage> {
    const tables = await this.tablesReader.read(branch);
    const matching = await tables.matching(filters);
    const fromCursor = matching.filter(
      ({ position }) =>
        after === undefined || compareTablePositions(position, after) > 0,
    );
    const onPage = fromCursor.slice(0, first);
    const edges = await this.tableItems.edgesOf(onPage, tables);

    return {
      ...tables.readState,
      edges,
      pageInfo: {
        hasNextPage: fromCursor.length > onPage.length,
        endCursor: edges.at(-1)?.cursor ?? null,
      },
      totalCount: matching.length,
    };
  }
}
