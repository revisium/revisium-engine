import { deepEqual } from '@revisium/schema-toolkit/lib';
import type { Row } from 'src/engine-prisma-types';
import type {
  LeafOwner,
  WholeColumn,
} from 'src/features/partial-changes/structure/column-owners';
import type { ComparedRowColumn } from 'src/features/share/compared-columns';

export type ContentColumns = Pick<Row, ComparedRowColumn>;

const WHOLE_COLUMN_EQUALITY: Readonly<
  Record<WholeColumn, (left: ContentColumns, right: ContentColumns) => boolean>
> = {
  id: (left, right) => left.id === right.id,
  publishedAt: (left, right) =>
    left.publishedAt.getTime() === right.publishedAt.getTime(),
  meta: (left, right) => deepEqual(left.meta, right.meta),
  schemaHash: (left, right) => left.schemaHash === right.schemaHash,
};

const WHOLE_COLUMNS: readonly WholeColumn[] = [
  'id',
  'publishedAt',
  'meta',
  'schemaHash',
];

export function differInContent(
  left: ContentColumns,
  right: ContentColumns,
): boolean {
  return left.hash !== right.hash || differingColumnsOf(left, right).length > 0;
}

export function differingColumnsOf(
  left: ContentColumns,
  right: ContentColumns,
): WholeColumn[] {
  return WHOLE_COLUMNS.filter(
    (column) => !WHOLE_COLUMN_EQUALITY[column](left, right),
  );
}

export function differingLeavesOf(
  head: Row,
  draft: Row,
  leaves: readonly LeafOwner[],
): LeafOwner[] {
  return leaves.filter(
    ({ pointer }) =>
      !deepEqual(pointer.valueIn(head.data), pointer.valueIn(draft.data)),
  );
}
