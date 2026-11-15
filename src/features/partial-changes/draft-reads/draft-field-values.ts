import { Injectable } from '@nestjs/common';
import type { Row, Sql } from 'src/engine-prisma-types';
import { oppositeOf } from 'src/features/draft-revision/commands/impl/target-write-plan';
import type { DraftFieldValueRequest } from 'src/features/partial-changes/draft-reads/draft-read-request';
import { revisionIdOn } from 'src/features/partial-changes/draft-reads/draft-row-items';
import { DraftTablesReader } from 'src/features/partial-changes/draft-reads/draft-tables';
import {
  measuredValueOf,
  textSliceOf,
} from 'src/features/partial-changes/draft-reads/json-values';
import {
  rowOfOtherSideIdSql,
  rowOfTableVersionSql,
} from 'src/features/partial-changes/draft-reads/side-row-sql';
import type {
  DraftFieldValue,
  DraftValueSide,
} from 'src/features/partial-changes/queries/impl/get-draft-field-value.query';
import type {
  ChangesSnapshot,
  TablePair,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import { PluginService } from 'src/features/plugin/plugin.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

type ValueAtPath = Pick<
  DraftFieldValue,
  'value' | 'valueBytes' | 'valueToken' | 'text'
>;

// A row version on the side read, in the table version that holds it there.
interface SideRow {
  readonly tableId: string;
  readonly row: Row;
}

const NO_VALUE: ValueAtPath = {
  value: null,
  valueBytes: null,
  valueToken: null,
};

@Injectable()
export class DraftFieldValues {
  constructor(
    private readonly tablesReader: DraftTablesReader,
    private readonly transactionService: TransactionPrismaService,
    private readonly plugins: PluginService,
  ) {}

  private get transaction() {
    return this.transactionService.getTransaction();
  }

  public async readValue(
    request: DraftFieldValueRequest,
  ): Promise<DraftFieldValue> {
    const tables = await this.tablesReader.read(request.branch);
    const { snapshot } = tables.compared;
    const sideRow = await this.readSideRow(snapshot, request);

    if (!sideRow) {
      return { ...tables.readState, ...NO_VALUE };
    }

    const data = await this.computedDataOf(snapshot, request.side, sideRow);

    return { ...tables.readState, ...valueAt(data, request) };
  }

  // The table and the row that hold the ids on the side read; only when none holds an id there, the one that holds it
  // on the other side, as a renamed table or row.
  private async readSideRow(
    snapshot: ChangesSnapshot,
    { side, tableId, rowId }: DraftFieldValueRequest,
  ): Promise<SideRow | undefined> {
    const pair = tablePairNamed(snapshot.tables, side, tableId);
    const table = pair?.[side];

    if (!pair || !table) {
      return undefined;
    }

    const row =
      (await this.readRow(rowOfTableVersionSql(table.versionId, rowId))) ??
      (await this.readRowOfOtherSideId(pair, side, rowId));

    return row && { tableId: table.id, row };
  }

  private async readRowOfOtherSideId(
    pair: TablePair,
    side: DraftValueSide,
    rowId: string,
  ): Promise<Row | undefined> {
    const table = pair[side];
    const other = pair[oppositeOf(side)];

    if (!table || !other) {
      return undefined;
    }

    return this.readRow(
      rowOfOtherSideIdSql(table.versionId, other.versionId, rowId),
    );
  }

  private async readRow(query: Sql): Promise<Row | undefined> {
    const [row] = await this.transaction.$queryRaw<Row[]>(query);

    return row;
  }

  // The row's data with its formula values computed, as the row read computes the rows of its page.
  private async computedDataOf(
    snapshot: ChangesSnapshot,
    side: DraftValueSide,
    { tableId, row }: SideRow,
  ): Promise<unknown> {
    await this.plugins.computeRows({
      revisionId: revisionIdOn(snapshot, side),
      tableId,
      rows: [row],
    });

    return row.data;
  }
}

function tablePairNamed(
  pairs: readonly TablePair[],
  side: DraftValueSide,
  tableId: string,
): TablePair | undefined {
  return (
    pairs.find((pair) => pair[side]?.id === tableId) ??
    pairs.find(
      (pair) =>
        pair[side] !== undefined && pair[oppositeOf(side)]?.id === tableId,
    )
  );
}

// A string comes with its range: the part from the offset, where it starts and the length of the whole string.
function valueAt(
  data: unknown,
  { pointer, offset, limit }: DraftFieldValueRequest,
): ValueAtPath {
  const value = pointer.valueIn(data);

  if (value === undefined) {
    return NO_VALUE;
  }

  const { bytes, token } = measuredValueOf(value);

  if (typeof value !== 'string') {
    return { value, valueBytes: bytes, valueToken: token };
  }

  const slice = textSliceOf(value, offset, limit);

  return {
    value: slice.text,
    valueBytes: bytes,
    valueToken: token,
    text: { offset: slice.offset, totalLength: value.length },
  };
}
