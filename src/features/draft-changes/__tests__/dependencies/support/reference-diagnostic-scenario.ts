import type { CandidateBlocker } from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { givenSelfRowRenameWithForeignKey } from './dependency-scenario';

export async function givenUnparseableDraftWithBlockedDiagnostics() {
  const { data } = await givenSelfRowRenameWithForeignKey('commit');
  const schemaRow = data.snapshot.draft.tables
    .find(({ id }) => id === SystemTables.Schema)
    ?.rows.find(({ id }) => id === 'products');
  if (!schemaRow) {
    throw new Error('Expected the Draft products schema row.');
  }
  schemaRow.data = { type: 'unsupported' };

  const blockers: CandidateBlocker[] = [
    {
      code: 'SCOPE_MISMATCH',
      message: 'The candidate operation scope does not match.',
      role: 'draft',
      tableCreatedId: 'stable-products',
    },
    {
      code: 'EXCLUDED_PREREQUISITE',
      message: 'A required candidate effect is excluded.',
      role: 'draft',
      tableCreatedId: 'stable-products',
      path: '/properties/link',
    },
  ];

  return {
    data,
    blockers,
  };
}
