import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import { compareUnits } from 'src/features/partial-changes/catalogue/unit-order';
import type { ListingCursor } from 'src/features/partial-changes/listing/listing-cursor';
import type { ListingTable } from 'src/features/partial-changes/listing/listing-tables';
import type { RowBound } from 'src/features/partial-changes/snapshot/changes-snapshot';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';

export class ListingPage {
  private readonly listed: CatalogueUnit[] = [];
  private lastRowContinues = false;

  constructor(
    private readonly pageSize: number,
    private readonly cursor: ListingCursor | undefined,
  ) {}

  public get units(): readonly CatalogueUnit[] {
    return this.listed;
  }

  public get isFull(): boolean {
    return this.listed.length >= this.pageSize;
  }

  public get remaining(): number {
    return this.pageSize - this.listed.length;
  }

  public tablesFromCursor(tables: readonly ListingTable[]): ListingTable[] {
    const cursorTableId = this.cursor?.last.unit.tableId;

    if (cursorTableId === undefined) {
      return [...tables];
    }

    return tables.filter(
      ({ tableId }) => compareCodePoints(tableId, cursorTableId) >= 0,
    );
  }

  public rowsFromCursorIn(tableId: string): RowBound | undefined {
    if (this.cursor?.last.unit.tableId !== tableId) {
      return undefined;
    }

    return this.cursor.rows;
  }

  public add(unitsInListingOrder: readonly CatalogueUnit[]): void {
    const unlisted = unitsInListingOrder.filter((unit) =>
      this.isAfterCursor(unit),
    );
    const taken = unlisted.slice(0, this.remaining);
    const last = taken.at(-1);

    if (last) {
      this.listed.push(...taken);
      this.lastRowContinues = continuesRow(last, unlisted[taken.length]);
    }
  }

  public nextCursor(): ListingCursor | undefined {
    const last = this.listed.at(-1);

    if (!this.isFull || !last) {
      return undefined;
    }

    return {
      last: { key: last.key, unit: last.unit },
      rows: this.rowsAfter(last),
    };
  }

  private isAfterCursor(unit: CatalogueUnit): boolean {
    return !this.cursor || compareUnits(unit, this.cursor.last) > 0;
  }

  private rowsAfter({ unit }: CatalogueUnit): RowBound | undefined {
    if (unit.rowId === undefined) {
      return undefined;
    }

    return { rowId: unit.rowId, inclusive: this.lastRowContinues };
  }
}

function continuesRow(
  last: CatalogueUnit,
  next: CatalogueUnit | undefined,
): boolean {
  return next !== undefined && next.unit.rowId === last.unit.rowId;
}
