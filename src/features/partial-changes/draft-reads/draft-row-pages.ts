import { Injectable } from '@nestjs/common';
import {
  compareTablePositions,
  type RowPosition,
  type TablePosition,
} from 'src/features/partial-changes/draft-reads/draft-cursor';
import type {
  DraftRowChangesRequest,
  RowFilters,
  RowPaging,
} from 'src/features/partial-changes/draft-reads/draft-read-request';
import {
  DraftRowItems,
  type PagedTable,
} from 'src/features/partial-changes/draft-reads/draft-row-items';
import {
  type DraftTable,
  DraftTablesReader,
} from 'src/features/partial-changes/draft-reads/draft-tables';
import { ReportedRowPairsReader } from 'src/features/partial-changes/draft-reads/reported-row-pairs-reader';
import type {
  RowRange,
  TableRows,
} from 'src/features/partial-changes/draft-reads/reported-rows-sql';
import { hasChangeTypeAmong } from 'src/features/partial-changes/draft-reads/table-filters';
import type {
  DraftRowChangeKind,
  DraftRowPage,
} from 'src/features/partial-changes/queries/impl/get-draft-row-changes.query';
import { ChangeType } from 'src/features/revision-changes/types';

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

  public async readPage(
    request: DraftRowChangesRequest,
  ): Promise<DraftRowPage> {
    const { branch, first, filters, fieldsPerRow } = request;
    const tables = await this.tablesReader.read(branch);
    const page = await this.readPairs(
      tablesFrom(tablesWithRowsOf(tables.listed, filters), request),
      { first, filters, paging: request },
    );
    const edges = await this.rowItems.edgesOf(page.tables, tables.compared, {
      orderBy: request.orderBy,
      fieldsPerRow,
    });

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
    tables: readonly TableWithRows[],
    {
      first,
      filters,
      paging,
    }: { first: number; filters: RowFilters; paging: RowPaging },
  ): Promise<PageOfTables> {
    const paged: PagedTable[] = [];
    let listed = 0;

    for (const { table, rows } of tables) {
      const range = rangeIn(table, paging, Math.max(first - listed, 1));
      const { pairs, hasMore, companions } =
        await this.pairsReader.readPairsPage(rows, filters, range);

      if (listed >= first) {
        if (pairs.length > 0) {
          return { tables: paged, hasNextPage: true };
        }

        continue;
      }

      if (pairs.length > 0) {
        paged.push({ table, pairs, companions });
        listed += pairs.length;
      }

      if (listed >= first && hasMore) {
        return { tables: paged, hasNextPage: true };
      }
    }

    return { tables: paged, hasNextPage: false };
  }
}

interface TableWithRows {
  readonly table: DraftTable;
  readonly rows: TableRows;
}

// The tables whose rows the filters can list: those a table id names, and not a created or removed table whose one
// change type the change types leave out.
function tablesWithRowsOf(
  tables: readonly DraftTable[],
  { tableId, changeTypes }: RowFilters,
): TableWithRows[] {
  return tablesNamed(tables, tableId).flatMap((table) => {
    const { rows } = table;

    if (!rows || !mayListRowsOf(rows, changeTypes)) {
      return [];
    }

    return [{ table, rows }];
  });
}

// The table items that show the id; only when none does, the renamed table whose Head id it is.
function tablesNamed(
  tables: readonly DraftTable[],
  tableId: string | undefined,
): readonly DraftTable[] {
  if (tableId === undefined) {
    return tables;
  }

  const showing = tables.filter(({ position }) => position.tableId === tableId);

  if (showing.length > 0) {
    return showing;
  }

  return tables.filter(({ pair }) => pair.head?.id === tableId);
}

function mayListRowsOf(
  rows: TableRows,
  changeTypes: readonly DraftRowChangeKind[] | undefined,
): boolean {
  if (rows.kind === 'compared') {
    return changeTypes === undefined || changeTypes.length > 0;
  }

  if (rows.side === 'head') {
    return hasChangeTypeAmong(ChangeType.Removed, changeTypes);
  }

  return hasChangeTypeAmong(ChangeType.Added, changeTypes);
}

// The tables of the order from the cursor's table. The recent order lists the rows of one table id: those of a table
// in the Draft first, then those of the removed table at its id, which has only removed rows.
function tablesFrom(
  tables: readonly TableWithRows[],
  { orderBy, after }: RowPaging,
): TableWithRows[] {
  const compare = tableOrderOf(orderBy);
  const ordered = [...tables].sort((left, right) =>
    compare(left.table.position, right.table.position),
  );

  if (!after) {
    return ordered;
  }

  return ordered.filter(
    ({ table }) => compare(table.position, after.table) >= 0,
  );
}

function tableOrderOf(
  orderBy: RowPaging['orderBy'],
): (left: TablePosition, right: TablePosition) => number {
  if (orderBy === 'recent') {
    return (left, right) =>
      Number(left.headOnly) - Number(right.headOnly) ||
      compareTablePositions(left, right);
  }

  return compareTablePositions;
}

function rangeIn(
  table: DraftTable,
  paging: RowPaging,
  limit: number,
): RowRange {
  if (paging.orderBy === 'recent') {
    return { orderBy: 'recent', limit, after: positionIn(table, paging.after) };
  }

  return {
    orderBy: 'id',
    limit,
    afterRowId: positionIn(table, paging.after)?.rowId,
  };
}

// The cursor's position applies within its own table; the tables after it are read from their first row.
function positionIn<Position extends RowPosition>(
  { position }: DraftTable,
  after: Position | undefined,
): Position | undefined {
  if (!after || compareTablePositions(position, after.table) !== 0) {
    return undefined;
  }

  return after;
}
