import {
  DraftRevisionStateRow,
  DraftRevisionStateTable,
} from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';

export function sameRow(
  left: DraftRevisionStateRow,
  right: DraftRevisionStateRow,
): boolean {
  return (
    left.id === right.id &&
    left.createdId === right.createdId &&
    left.createdAt.getTime() === right.createdAt.getTime() &&
    left.publishedAt.getTime() === right.publishedAt.getTime() &&
    left.hash === right.hash &&
    left.schemaHash === right.schemaHash &&
    sameJson(left.data, right.data) &&
    sameJson(left.meta, right.meta) &&
    sameStringSet(
      left.fileBlobs.map(({ id }) => id),
      right.fileBlobs.map(({ id }) => id),
    )
  );
}

export function sameTable(
  left: DraftRevisionStateTable,
  right: DraftRevisionStateTable,
  rowVersionIds: string[],
): boolean {
  return (
    left.id === right.id &&
    left.createdId === right.createdId &&
    left.createdAt.getTime() === right.createdAt.getTime() &&
    left.system === right.system &&
    sameStringSet(
      left.rows.map(({ versionId }) => versionId),
      rowVersionIds,
    )
  );
}

function sameStringSet(left: string[], right: string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    leftSet.size === rightSet.size &&
    [...leftSet].every((value) => rightSet.has(value))
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameJson(value, right[index]))
    );
  }
  if (
    typeof left !== 'object' ||
    left === null ||
    typeof right !== 'object' ||
    right === null
  ) {
    return false;
  }

  const leftObject = left as Record<string, unknown>;
  const rightObject = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftObject);
  const rightKeys = Object.keys(rightObject);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(rightObject, key) &&
        sameJson(leftObject[key], rightObject[key]),
    )
  );
}
