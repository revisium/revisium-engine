import { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';

export interface CleanupCandidates {
  tableVersionIds: string[];
  rowVersionIds: string[];
}

export function collectCleanupCandidates(
  states: DraftRevisionState[],
): CleanupCandidates {
  const tableVersionIds: string[] = [];
  const rowVersionIds: string[] = [];
  for (const state of states) {
    for (const table of state.tables) {
      if (table.readonly) {
        continue;
      }
      tableVersionIds.push(table.versionId);
      for (const row of table.rows) {
        if (!row.readonly) {
          rowVersionIds.push(row.versionId);
        }
      }
    }
  }
  return {
    tableVersionIds: [...new Set(tableVersionIds)],
    rowVersionIds: [...new Set(rowVersionIds)],
  };
}
