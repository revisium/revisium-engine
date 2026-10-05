import {
  calculateCandidate,
  CANDIDATE_ROW_ID,
  givenSelectedCandidate,
  requireCandidateRowData,
  rowFields,
} from './support/candidate-scenario';
import { CATALOGUE_TABLE_CREATED_ID } from 'src/features/draft-changes/__tests__/catalogue/support/catalogue-scenario';
import { rowInput } from 'src/features/draft-changes/__tests__/schema/support/schema-projection-fixture';

describe('draft changes commit candidates', () => {
  it('commits the selected field while leaving another Draft edit pending', async () => {
    const { data } = await givenSelectedCandidate({
      operation: 'commit',
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
        'head',
        CATALOGUE_TABLE_CREATED_ID,
        CANDIDATE_ROW_ID,
      ),
    ).toEqual({ title: 'Draft', price: 10 });
    expect(
      requireCandidateRowData(
        result,
        'draft',
        CATALOGUE_TABLE_CREATED_ID,
        CANDIDATE_ROW_ID,
      ),
    ).toEqual({ title: 'Draft', price: 20 });
  });

  it('keeps an excluded child edit pending under a broad include', async () => {
    const { data } = await givenSelectedCandidate({
      operation: 'commit',
      selection: {
        include: [{ kind: 'all' }],
        exclude: [
          {
            kind: 'rowFields',
            tableId: 'products',
            rowId: CANDIDATE_ROW_ID,
            paths: ['/price'],
          },
        ],
      },
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
        'head',
        CATALOGUE_TABLE_CREATED_ID,
        CANDIDATE_ROW_ID,
      ),
    ).toEqual({ title: 'Draft', price: 10 });
  });
});
