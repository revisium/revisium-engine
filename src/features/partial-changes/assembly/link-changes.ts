import type { MergedRow } from 'src/features/partial-changes/assembly/row-merger';

export interface LinkChanges {
  readonly removedLinks: readonly string[];
  readonly addedLinks: readonly string[];
  readonly newRows: readonly MergedRow[];
}

export const NO_LINK_CHANGES: LinkChanges = {
  removedLinks: [],
  addedLinks: [],
  newRows: [],
};
