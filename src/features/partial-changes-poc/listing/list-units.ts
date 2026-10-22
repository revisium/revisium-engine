import { BadRequestException } from '@nestjs/common';
import {
  CatalogueUnit,
  ChangeCatalogue,
  toPublicUnit,
} from 'src/features/partial-changes-poc/catalogue/change-catalogue.types';
import { exactSelectorOf } from 'src/features/partial-changes-poc/listing/unit-selectors';
import { ListedUnit } from 'src/features/partial-changes-poc/partial-changes.types';

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 1000;

export interface UnitsPageRequest {
  cursor?: string;
  limit?: number;
  tableId?: string;
}

export interface UnitsPage {
  units: ListedUnit[];
  nextCursor?: string;
  complete: boolean;
}

interface Cursor {
  after: string[];
  from: string;
}

export function listUnits(
  catalogue: ChangeCatalogue,
  page: UnitsPageRequest,
  unreadFrom?: string,
): UnitsPage {
  const limit = pageSizeOf(page.limit);
  const after = page.cursor ? decodeCursor(page.cursor).after : undefined;
  const known = [...catalogue.units.values()]
    .filter(
      (unit) => page.tableId === undefined || unit.tableId === page.tableId,
    )
    .filter((unit) => unreadFrom === undefined || unit.tableId < unreadFrom)
    .map((unit) => ({ unit, order: orderOf(unit) }))
    .filter(({ order }) => !after || compareOrder(order, after) > 0)
    .sort((a, b) => compareOrder(a.order, b.order));
  const slice = known.slice(0, limit);
  const units = slice.map(({ unit }) => listedUnit(catalogue, unit));
  const last = slice.at(-1);

  if (last && known.length > limit) {
    return {
      units,
      nextCursor: encodeCursor({ after: last.order, from: last.unit.tableId }),
      complete: true,
    };
  }
  if (unreadFrom === undefined) {
    return { units, complete: true };
  }
  if (last && known.length === limit) {
    return {
      units,
      nextCursor: encodeCursor({ after: last.order, from: unreadFrom }),
      complete: true,
    };
  }
  return { units, complete: false };
}

export function cursorTableOf(page: UnitsPageRequest): string | undefined {
  return page.cursor ? decodeCursor(page.cursor).from : undefined;
}

function listedUnit(
  catalogue: ChangeCatalogue,
  unit: CatalogueUnit,
): ListedUnit {
  const listed: ListedUnit = toPublicUnit(unit);
  const exact = exactSelectorOf(catalogue, unit);
  if (exact?.side) {
    listed.side = exact.side;
  }
  const structure = structureLinkOf(catalogue, unit);
  if (structure) {
    listed.structure = toPublicUnit(structure);
  }
  if (exact) {
    listed.selector = exact.selector;
  }
  return listed;
}

function structureLinkOf(
  catalogue: ChangeCatalogue,
  unit: CatalogueUnit,
): CatalogueUnit | undefined {
  const key = catalogue.tables.get(unit.tableCreatedId)?.structureUnit;
  return key && key !== unit.key ? catalogue.units.get(key) : undefined;
}

function orderOf(unit: CatalogueUnit): string[] {
  return [
    unit.tableId,
    unit.rowId ?? '',
    unit.kind,
    unit.path ?? '',
    unit.previousTableId ?? '',
    unit.previousRowId ?? '',
    unit.key,
  ];
}

function compareOrder(a: readonly string[], b: readonly string[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const left = a[index] ?? '';
    const right = b[index] ?? '';
    if (left !== right) {
      return left < right ? -1 : 1;
    }
  }
  return 0;
}

function pageSizeOf(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_PAGE_SIZE;
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new BadRequestException(
      `limit must be an integer from 1 to ${MAX_PAGE_SIZE}`,
    );
  }
  return limit;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(cursor: string): Cursor {
  const parsed = parseCursor(cursor) as Partial<Cursor> | undefined;
  if (
    Array.isArray(parsed?.after) &&
    parsed.after.every((item) => typeof item === 'string') &&
    typeof parsed.from === 'string'
  ) {
    return { after: parsed.after, from: parsed.from };
  }
  throw new BadRequestException('cursor is not a listChanges cursor');
}

function parseCursor(cursor: string): unknown {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString());
  } catch {
    return undefined;
  }
}
