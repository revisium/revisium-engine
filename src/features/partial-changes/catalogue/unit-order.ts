import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';

const LAST_SINGLE_UNIT_CODE_POINT = 0xffff;
const SURROGATE_PAIR_LENGTH = 2;

type OrderedUnit = Pick<CatalogueUnit, 'key' | 'unit'>;

export function compareUnits(
  { key: leftKey, unit: left }: OrderedUnit,
  { key: rightKey, unit: right }: OrderedUnit,
): number {
  return (
    compareCodePoints(left.tableId, right.tableId) ||
    compareAbsentFirst(left.rowId, right.rowId) ||
    compareCodePoints(left.kind, right.kind) ||
    compareAbsentFirst(left.path, right.path) ||
    compareAbsentFirst(left.previousTableId, right.previousTableId) ||
    compareAbsentFirst(left.previousRowId, right.previousRowId) ||
    compareCodePoints(leftKey, rightKey)
  );
}

export function compareCodePoints(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  let index = 0;

  while (index < length) {
    const leftCodePoint = left.codePointAt(index) ?? 0;
    const rightCodePoint = right.codePointAt(index) ?? 0;

    if (leftCodePoint !== rightCodePoint) {
      return leftCodePoint - rightCodePoint;
    }

    index += lengthOf(leftCodePoint);
  }

  return left.length - right.length;
}

function compareAbsentFirst(
  left: string | undefined,
  right: string | undefined,
): number {
  if (left === right) {
    return 0;
  }

  if (left === undefined) {
    return -1;
  }

  if (right === undefined) {
    return 1;
  }

  return compareCodePoints(left, right);
}

function lengthOf(codePoint: number): number {
  if (codePoint > LAST_SINGLE_UNIT_CODE_POINT) {
    return SURROGATE_PAIR_LENGTH;
  }

  return 1;
}
