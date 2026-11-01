import { Injectable } from '@nestjs/common';
import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import { buildChangeCatalogue } from 'src/features/partial-changes/catalogue/change-catalogue';
import { HeadViewsMigration } from 'src/features/partial-changes/catalogue/head-views-migration';
import { buildRowUnits } from 'src/features/partial-changes/catalogue/row-units';
import { compareUnits } from 'src/features/partial-changes/catalogue/unit-order';
import { listedUnitsOf } from 'src/features/partial-changes/listing/listed-units';
import {
  encodeListingCursor,
  type ListingCursor,
} from 'src/features/partial-changes/listing/listing-cursor';
import { ListingPage } from 'src/features/partial-changes/listing/listing-page';
import type { ListingRequest } from 'src/features/partial-changes/listing/listing-request';
import {
  type ListingTable,
  listingTablesOf,
} from 'src/features/partial-changes/listing/listing-tables';
import type { ListChangesResult } from 'src/features/partial-changes/queries/impl/list-draft-changes.query';
import { ChangesSnapshotReader } from 'src/features/partial-changes/snapshot/changes-snapshot-reader.service';
import {
  type ChangedRows,
  type ComparedTable,
  type RowPair,
  unitRowIdOf,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import {
  ComparedSnapshotReader,
  type ComparisonScope,
} from 'src/features/partial-changes/snapshot/compared-snapshot-reader.service';

const PARTIAL_OPERATION: ComparisonScope = { wholeDraft: false };
const NO_CHANGED_ROWS: ChangedRows = new Map();

@Injectable()
export class UnitListing {
  constructor(
    private readonly comparedSnapshotReader: ComparedSnapshotReader,
    private readonly snapshotReader: ChangesSnapshotReader,
    private readonly headViews: HeadViewsMigration,
  ) {}

  public async listPage(request: ListingRequest): Promise<ListChangesResult> {
    const compared = await this.comparedSnapshotReader.readComparedSnapshot(
      request.branch,
      PARTIAL_OPERATION,
    );
    const tableLevel = buildChangeCatalogue(
      { ...compared, changedRows: NO_CHANGED_ROWS },
      this.headViews,
    );
    const tables = listingTablesOf(compared, tableLevel.units, request.tableId);
    const page = new ListingPage(request.pageSize, request.cursor);

    for (const table of page.tablesFromCursor(tables)) {
      await this.listTable(table, page);

      if (page.isFull) {
        break;
      }
    }

    return {
      headRevisionId: compared.snapshot.headRevisionId,
      draftRevisionId: compared.snapshot.draftRevisionId,
      units: listedUnitsOf(page.units, tableLevel.units),
      nextCursor: encodedCursorOf(page.nextCursor()),
      refusedTables: tableLevel.refusedTables,
    };
  }

  private async listTable(
    table: ListingTable,
    page: ListingPage,
  ): Promise<void> {
    page.add(table.units);

    if (table.changedRows) {
      await this.listChangedRows(table.tableId, table.changedRows, page);
    }
  }

  private async listChangedRows(
    tableId: string,
    table: ComparedTable,
    page: ListingPage,
  ): Promise<void> {
    let from = page.rowsFromCursorIn(tableId);

    while (!page.isFull) {
      const rowLimit = page.rowsToRead;
      const pairs = await this.snapshotReader.readChangedRowsFrom(table, {
        from,
        rowLimit,
      });
      const rowIds = distinctRowIdsOf(pairs);
      const lastRowId = rowIds.at(-1);
      const tableEnded = pairs.length < rowLimit;

      page.addRowsRead(tableId, rowIds, rowUnitsOf(tableId, table, pairs));

      if (tableEnded || lastRowId === undefined) {
        return;
      }

      from = { rowId: lastRowId, inclusive: false };
    }
  }
}

function rowUnitsOf(
  tableId: string,
  { identity, structure }: ComparedTable,
  pairs: readonly RowPair[],
): CatalogueUnit[] {
  const { units } = buildRowUnits({ identity, tableId, structure, pairs });

  return [...units].sort(compareUnits);
}

function distinctRowIdsOf(pairs: readonly RowPair[]): string[] {
  return [...new Set(pairs.map(unitRowIdOf))];
}

function encodedCursorOf(cursor: ListingCursor | undefined): string | null {
  if (!cursor) {
    return null;
  }

  return encodeListingCursor(cursor);
}
