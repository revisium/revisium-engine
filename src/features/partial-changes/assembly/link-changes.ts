import type { RowLinkChanges } from 'src/features/draft-revision/commands/impl/target-write-plan';

export const NO_LINK_CHANGES: RowLinkChanges = {
  removedRowVersionIds: [],
  addedRowVersionIds: [],
  newRows: [],
};
