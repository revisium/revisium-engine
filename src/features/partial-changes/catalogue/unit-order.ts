import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';

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
