import type { FieldRef } from 'src/features/partial-changes/selection/selection';

export function titleOf(tableId: string, rowId: string): FieldRef {
  return { tableId, rowId, path: '/title' };
}
