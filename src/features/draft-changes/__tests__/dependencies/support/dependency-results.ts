import type {
  CandidateDependencyBlocker,
  ResolveCandidateDependenciesResult,
} from 'src/features/draft-changes/queries/impl/resolve-candidate-dependencies.query';
import type { CandidateBlocker } from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import type { DraftRevisionStateRow } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';

export function requireDependencyBlocker(
  result: ResolveCandidateDependenciesResult,
  code: CandidateDependencyBlocker['code'],
  match: Partial<CandidateDependencyBlocker> = {},
): CandidateDependencyBlocker {
  if (result.status !== 'blocked') {
    throw new Error(
      `Expected dependency blocker '${code}': ${JSON.stringify(result)}`,
    );
  }
  const blocker = result.blockers.find(
    (candidate) =>
      candidate.code === code &&
      Object.entries(match).every(
        ([key, value]) =>
          (candidate as unknown as Record<string, unknown>)[key] === value,
      ),
  );
  if (!blocker || !('targetTableId' in blocker)) {
    throw new Error(
      `Expected dependency blocker '${code}': ${JSON.stringify(result)}`,
    );
  }
  return blocker;
}

export function requireCandidateBlocker(
  result: ResolveCandidateDependenciesResult,
  code: CandidateBlocker['code'],
): CandidateBlocker {
  if (result.status !== 'blocked') {
    throw new Error(`Expected candidate blocker '${code}'.`);
  }
  const blocker = result.blockers.find((candidate) => candidate.code === code);
  if (!blocker || blocker.code !== code || 'targetTableId' in blocker) {
    throw new Error(`Expected candidate blocker '${code}'.`);
  }
  return blocker as CandidateBlocker;
}

export function requireResolvedDependencies(
  result: ResolveCandidateDependenciesResult,
): Extract<ResolveCandidateDependenciesResult, { status: 'resolved' }> {
  if (result.status !== 'resolved') {
    throw new Error(
      `Expected candidate dependencies to resolve: ${JSON.stringify(result)}`,
    );
  }
  return result;
}

export function resolvedRowData(
  result: ResolveCandidateDependenciesResult,
  role: 'head' | 'draft',
  tableCreatedId: string,
  rowCreatedId: string,
): DraftRevisionStateRow['data'] {
  if (result.status !== 'resolved') {
    throw new Error('Expected resolved candidate rows.');
  }
  const table = result[role].tables.find(
    (candidate) => candidate.createdId === tableCreatedId,
  );
  const row = table?.rows.find(
    (candidate) => candidate.createdId === rowCreatedId,
  );
  if (!row) {
    throw new Error(`Expected ${role} row '${rowCreatedId}'.`);
  }
  return row.data;
}
