import type { TableFilters } from 'src/features/partial-changes/draft-reads/draft-read-request';
import { ChangeType } from 'src/features/revision-changes/types';

// RENAMED and MODIFIED also match RENAMED_AND_MODIFIED, which is both.
export function hasChangeTypeAmong(
  changeType: ChangeType,
  changeTypes: readonly ChangeType[] | undefined,
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

function changeTypesMatching(changeTypes: readonly ChangeType[]): ChangeType[] {
  if (
    changeTypes.includes(ChangeType.Renamed) ||
    changeTypes.includes(ChangeType.Modified)
  ) {
    return [...changeTypes, ChangeType.RenamedAndModified];
  }

  return [...changeTypes];
}
