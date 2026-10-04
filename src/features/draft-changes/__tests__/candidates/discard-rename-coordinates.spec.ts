import {
  calculateCandidate,
  CANDIDATE_ROW_ID,
  givenRenamedFieldDiscardCandidate,
  givenDiscardWithDeniedRenamedField,
  requireCandidateRowData,
} from './support/candidate-scenario';
import { CATALOGUE_TABLE_CREATED_ID } from 'src/features/draft-changes/__tests__/catalogue/support/catalogue-scenario';

describe('discard values after schema field renames', () => {
  it('restores a required field at its retained Head path and preserves an unrelated Draft edit', async () => {
    const { data } = await givenRenamedFieldDiscardCandidate(true);

    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    expect(
      requireCandidateRowData(
        result,
        'draft',
        CATALOGUE_TABLE_CREATED_ID,
        CANDIDATE_ROW_ID,
      ),
    ).toEqual({ old: 'Head', note: 'Draft' });
  });

  it('restores an optional field at its retained Head path and preserves an unrelated Draft edit', async () => {
    const { data } = await givenRenamedFieldDiscardCandidate(false);

    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    expect(
      requireCandidateRowData(
        result,
        'draft',
        CATALOGUE_TABLE_CREATED_ID,
        CANDIDATE_ROW_ID,
      ),
    ).toEqual({ old: 'Head', note: 'Draft' });
  });

  it.each(['path', 'change'] as const)(
    'leaves a pending renamed field unchanged while discarding note (%s exclusion)',
    async (denial) => {
      const data = await givenDiscardWithDeniedRenamedField(denial);

      const result = await calculateCandidate(data);

      expect(result.status).toBe('calculated');
      expect(
        requireCandidateRowData(
          result,
          'draft',
          CATALOGUE_TABLE_CREATED_ID,
          CANDIDATE_ROW_ID,
        ),
      ).toEqual({ new: 'Draft', note: 'Head' });
    },
  );
});
