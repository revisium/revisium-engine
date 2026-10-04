import {
  candidateRowData,
  calculateCandidate,
  CANDIDATE_ROW_ID,
  givenSelectedCandidate,
  requireCandidateRowData,
  rowFields,
  rowLifecycle,
} from './support/candidate-scenario';
import { CATALOGUE_TABLE_CREATED_ID } from 'src/features/draft-changes/__tests__/catalogue/support/catalogue-scenario';
import { rowInput } from 'src/features/draft-changes/__tests__/schema/support/schema-projection-fixture';

describe('draft changes discard candidates', () => {
  it('restores the selected field while preserving an independent Draft edit', async () => {
    const { data } = await givenSelectedCandidate({
      operation: 'discard',
      selection: rowFields('products', CANDIDATE_ROW_ID, ['/title']),
      scenario: {
        headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head', price: 10 })],
        draftRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Draft', price: 20 })],
      },
    });

    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    expect(
      requireCandidateRowData(
        result,
        'draft',
        CATALOGUE_TABLE_CREATED_ID,
        CANDIDATE_ROW_ID,
      ),
    ).toEqual({ title: 'Head', price: 20 });
  });

  it('removes a selected Draft-only row without validating it as retained data', async () => {
    const { data } = await givenSelectedCandidate({
      operation: 'discard',
      selection: rowLifecycle('products', ['new-row']),
      scenario: {
        headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head', price: 10 })],
        draftRows: [
          rowInput(CANDIDATE_ROW_ID, { title: 'Head', price: 10 }),
          rowInput('new-row', { title: 'Created', price: 20 }),
        ],
      },
    });

    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    expect(
      candidateRowData(result, 'draft', CATALOGUE_TABLE_CREATED_ID, 'new-row'),
    ).toBeUndefined();
  });
});
