import { Injectable } from '@nestjs/common';
import {
  compareTablePositions,
  type RowPosition,
} from 'src/features/partial-changes/draft-reads/draft-cursor';
import type { DraftRowChangesRequest } from 'src/features/partial-changes/draft-reads/draft-read-request';
import {
  DraftRowItems,
  type PagedTable,
} from 'src/features/partial-changes/draft-reads/draft-row-items';
import {
  type DraftTable,
  DraftTablesReader,
} from 'src/features/partial-changes/draft-reads/draft-tables';
import { ReportedRowPairsReader } from 'src/features/partial-changes/draft-reads/reported-row-pairs-reader';
import type { RowRange } from 'src/features/partial-changes/draft-reads/reported-rows-sql';
import type { DraftRowPage } from 'src/features/partial-changes/queries/impl/get-draft-row-changes.query';

interface PageOfTables {
  readonly tables: readonly PagedTable[];
  readonly hasNextPage: boolean;
}

@Injectable()
export class DraftRowPages {
  constructor(
    private readonly tablesReader: DraftTablesReader,
    private readonly pairsReader: ReportedRowPairsReader,
    private readonly rowItems: DraftRowItems,
  ) {}

  public async readPage({
    branch,
    first,
    after,
  }: DraftRowChangesRequest): Promise<DraftRowPage> {
    const tables = await this.tablesReader.read(branch);
    const page = await this.readPairs(tablesFrom(tables.listed, after), {
      first,
      after,
    });
    const edges = await this.rowItems.edgesOf(page.tables, tables.compared);

    return {
      ...tables.readState,
      edges,
      pageInfo: {
        hasNextPage: page.hasNextPage,
        endCursor: edges.at(-1)?.cursor ?? null,
      },
    };
  }

  // Reads the tables in order until the page is full; past a full page it reads only until an item follows it.
  private async readPairs(
    tables: readonly DraftTable[],
    { first, after }: { first: number; after?: RowPosition },
  ): Promise<PageOfTables> {
    const paged: PagedTable[] = [];
    let listed = 0;

    for (const table of tables) {
      if (!table.rows) {
        continue;
      }

      const range: RowRange = {
        afterRowId: rowIdAfterIn(table, after),
        limit: Math.max(first - listed, 1),
      };
      const { pairs, hasMore } = await this.pairsReader.readPairsPage(
        table.rows,
        range,
      );

      if (listed >= first) {
        if (pairs.length > 0) {
          return { tables: paged, hasNextPage: true };
        }

        continue;
      }

      if (pairs.length > 0) {
        paged.push({ table, pairs });
        listed += pairs.length;
      }

      if (listed >= first && hasMore) {
        return { tables: paged, hasNextPage: true };
      }
    }

    return { tables: paged, hasNextPage: false };
  }
}

function tablesFrom(
  tables: readonly DraftTable[],
  after: RowPosition | undefined,
): DraftTable[] {
  if (!after) {
    return [...tables];
  }

  return tables.filter(
    ({ position }) => compareTablePositions(position, after.table) >= 0,
  );
}

function rowIdAfterIn(
  { position }: DraftTable,
  after: RowPosition | undefined,
): string | undefined {
  if (!after || compareTablePositions(position, after.table) !== 0) {
    return undefined;
  }

  return after.rowId;
}
