import type {
  SourceHistoryGroup,
  SourceTableTaint,
  SourceTableTaintCode,
} from 'src/features/draft-changes/schema/source-history/source-history.types';

export function sourceTaint(
  code: SourceTableTaintCode,
  fromHistoryIndex: number,
  message: string,
): SourceTableTaint {
  return { code, fromHistoryIndex, message };
}

export function combineTaints(
  current: SourceTableTaint | undefined,
  candidate: SourceTableTaint | undefined,
): SourceTableTaint | undefined {
  if (!current) {
    return candidate;
  }
  if (candidate && candidate.fromHistoryIndex < current.fromHistoryIndex) {
    return candidate;
  }
  return current;
}

export function groupsBelowTaint(
  groups: SourceHistoryGroup[],
  taint: SourceTableTaint | undefined,
): SourceHistoryGroup[] {
  if (!taint) {
    return groups;
  }
  return groups.filter(
    ({ historyIndex }) => historyIndex < taint.fromHistoryIndex,
  );
}
