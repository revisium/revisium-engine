import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import { compareUnits } from 'src/features/partial-changes/catalogue/unit-order';
import type {
  ListedPosition,
  ListingCursor,
} from 'src/features/partial-changes/listing/listing-cursor';
import type { ListingTable } from 'src/features/partial-changes/listing/listing-tables';
import type { RowBound } from 'src/features/partial-changes/snapshot/changes-snapshot';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';

interface RowRead {
  readonly tableId: string;
  readonly rowId: string;
}

export class ListingPage {
  private readonly listed: CatalogueUnit[] = [];
  private lastRowContinues = false;
  private rowIdsRead = 0;
  private lastRowRead?: RowRead;

  constructor(
    private readonly pageSize: number,
    private readonly cursor: ListingCursor | undefined,
  ) {}

  public get units(): readonly CatalogueUnit[] {
    return this.listed;
  }

  public get isFull(): boolean {
    return this.hasAllUnits() || this.hasReadAllRows();
  }

  public get rowsToRead(): number {
    return Math.min(
      this.pageSize - this.listed.length,
      this.pageSize - this.rowIdsRead,
    );
  }

  public tablesFromCursor(tables: readonly ListingTable[]): ListingTable[] {
    const cursorTableId = this.cursor?.tableId;

    if (cursorTableId === undefined) {
      return [...tables];
    }

    return tables.filter(
      ({ tableId }) => compareCodePoints(tableId, cursorTableId) >= 0,
    );
  }

  public rowsFromCursorIn(tableId: string): RowBound | undefined {
    if (this.cursor?.tableId !== tableId) {
      return undefined;
    }

    return this.cursor.rows;
  }

  public addRowsRead(
    tableId: string,
    rowIds: readonly string[],
    unitsInListingOrder: readonly CatalogueUnit[],
  ): void {
    const lastRowId = rowIds.at(-1);

    if (lastRowId !== undefined) {
      this.rowIdsRead += rowIds.length;
      this.lastRowRead = { tableId, rowId: lastRowId };
    }

    this.add(unitsInListingOrder);
  }

  public add(unitsInListingOrder: readonly CatalogueUnit[]): void {
    const unlisted = unitsInListingOrder.filter((unit) =>
      this.isAfterCursor(unit),
    );
    const taken = unlisted.slice(0, this.pageSize - this.listed.length);
    const last = taken.at(-1);

    if (last) {
      this.listed.push(...taken);
      this.lastRowContinues = continuesRow(last, unlisted[taken.length]);
    }
  }

  public nextCursor(): ListingCursor | undefined {
    const last = this.listed.at(-1);

    if (this.hasAllUnits() && last) {
      return {
        tableId: last.unit.tableId,
        rows: this.rowsAfter(last),
        last: positionOf(last),
      };
    }

    if (this.hasReadAllRows() && this.lastRowRead) {
      return {
        tableId: this.lastRowRead.tableId,
        rows: { rowId: this.lastRowRead.rowId, inclusive: false },
        last: this.lastListedPosition(),
      };
    }

    return undefined;
  }

  private hasAllUnits(): boolean {
    return this.listed.length >= this.pageSize;
  }

  private hasReadAllRows(): boolean {
    return this.rowIdsRead >= this.pageSize;
  }

  private isAfterCursor(unit: CatalogueUnit): boolean {
    const last = this.cursor?.last;

    return !last || compareUnits(unit, last) > 0;
  }

  private rowsAfter({ unit }: CatalogueUnit): RowBound | undefined {
    if (unit.rowId === undefined) {
      return undefined;
    }

    return { rowId: unit.rowId, inclusive: this.lastRowContinues };
  }

  private lastListedPosition(): ListedPosition | undefined {
    const last = this.listed.at(-1);

    if (!last) {
      return this.cursor?.last;
    }

    return positionOf(last);
  }
}

function positionOf({ key, unit }: CatalogueUnit): ListedPosition {
  return { key, unit };
}

function continuesRow(
  last: CatalogueUnit,
  next: CatalogueUnit | undefined,
): boolean {
  return next !== undefined && next.unit.rowId === last.unit.rowId;
}
