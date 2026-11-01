import { deepEqual } from '@revisium/schema-toolkit/lib';
import type { Row } from 'src/engine-prisma-types';
import type {
  LeafOwner,
  WholeColumn,
} from 'src/features/partial-changes/structure/column-owners';
import type { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';

const WHOLE_COLUMN_EQUALITY: Readonly<
  Record<WholeColumn, (head: Row, draft: Row) => boolean>
> = {
  id: (head, draft) => head.id === draft.id,
  publishedAt: (head, draft) =>
    head.publishedAt.getTime() === draft.publishedAt.getTime(),
  meta: (head, draft) => deepEqual(head.meta, draft.meta),
  schemaHash: (head, draft) => head.schemaHash === draft.schemaHash,
};

const WHOLE_COLUMNS: readonly WholeColumn[] = [
  'id',
  'publishedAt',
  'meta',
  'schemaHash',
];

export function differInContent(head: Row, draft: Row): boolean {
  return head.hash !== draft.hash || differingColumnsOf(head, draft).length > 0;
}

export function differingColumnsOf(head: Row, draft: Row): WholeColumn[] {
  return WHOLE_COLUMNS.filter(
    (column) => !WHOLE_COLUMN_EQUALITY[column](head, draft),
  );
}

export function differingLeavesOf(
  head: Row,
  draft: Row,
  leaves: readonly LeafOwner[],
): LeafOwner[] {
  return leaves.filter(
    ({ pointer }) =>
      !deepEqual(
        leafValueOf(head.data, pointer),
        leafValueOf(draft.data, pointer),
      ),
  );
}

function leafValueOf(data: unknown, pointer: JsonPointer): unknown {
  return pointer.segments.reduce<unknown>(
    (value, segment) => ownPropertyOf(value, segment),
    data,
  );
}

function ownPropertyOf(value: unknown, name: string): unknown {
  if (
    typeof value !== 'object' ||
    value === null ||
    !Object.prototype.hasOwnProperty.call(value, name)
  ) {
    return undefined;
  }

  return (value as Record<string, unknown>)[name];
}
