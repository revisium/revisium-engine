import { deepEqual } from '@revisium/schema-toolkit/lib';
import type {
  CandidateBlocker,
  CalculateDataCandidatesQueryData,
} from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';

export function validateCandidateSelection(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
): CandidateBlocker[] {
  const { scope } = data.catalogue;
  if (
    scope.fingerprint !== data.snapshot.fingerprint ||
    scope.branchId !== data.snapshot.branch.id ||
    scope.headRevisionId !== data.snapshot.head.id ||
    scope.draftRevisionId !== data.snapshot.draft.id
  ) {
    return [
      {
        code: 'SCOPE_MISMATCH',
        message: 'Catalogue scope does not match the supplied snapshot.',
      },
    ];
  }
  const canonical = new Map(
    data.catalogue.entries.map((entry) => [entry.ref.value, entry]),
  );
  return [...data.selection.selected, ...data.selection.excluded].flatMap(
    (entry) => {
      const original = canonical.get(entry.ref.value);
      if (original && deepEqual(original, entry) && original.selectable) {
        return [];
      }
      return [
        {
          code: 'INVALID_SELECTION',
          message: `Selection reference '${entry.ref.value}' is unknown or has modified data.`,
        },
      ];
    },
  );
}
