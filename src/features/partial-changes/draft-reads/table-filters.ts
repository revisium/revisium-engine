import type { TableFilters } from 'src/features/partial-changes/draft-reads/draft-read-request';
import type { DraftRowChangeKind } from 'src/features/partial-changes/queries/impl/get-draft-row-changes.query';
import { ChangeType } from 'src/features/revision-changes/types';

const CHANGE_TYPES: ReadonlySet<DraftRowChangeKind> = new Set(
  Object.values(ChangeType),
);

// RENAMED and MODIFIED also match RENAMED_AND_MODIFIED, which is both.
export function hasChangeTypeAmong(
  changeType: ChangeType,
  changeTypes: readonly DraftRowChangeKind[] | undefined,
): boolean {
  if (changeTypes === undefined) {
    return true;
  }

  return changeTypesMatching(changeTypes).includes(changeType);
}

export function hasIdContaining(
  ids: readonly (string | undefined)[],
  search: string | undefined,
): boolean {
  if (search === undefined) {
    return true;
  }

  const term = search.toLowerCase();

  return ids.some((id) => id?.toLowerCase().includes(term));
}

export function matchesTableFilters(
  { changeTypes, search }: TableFilters,
  changeType: ChangeType,
  ids: readonly (string | undefined)[],
): boolean {
  return (
    hasIdContaining(ids, search) && hasChangeTypeAmong(changeType, changeTypes)
  );
}

// The change types a filter matches; REPLACED is the kind of a replaced row, not a change type.
export function changeTypesMatching(
  kinds: readonly DraftRowChangeKind[],
): ChangeType[] {
  const changeTypes = kinds.filter(isChangeType);

  if (
    changeTypes.includes(ChangeType.Renamed) ||
    changeTypes.includes(ChangeType.Modified)
  ) {
    return [...changeTypes, ChangeType.RenamedAndModified];
  }

  return changeTypes;
}

function isChangeType(kind: DraftRowChangeKind): kind is ChangeType {
  return CHANGE_TYPES.has(kind);
}
