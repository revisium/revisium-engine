import {
  calculateCandidate,
  candidateSchemaRowIdentity,
  candidateRowIntegrity,
  candidateRowSnapshot,
  CANDIDATE_ROW_ID,
  replaceCandidateRowData,
  corruptDraftRowHash,
  corruptDraftSchemaHistoryHash,
  givenRestoreHeadCandidate,
  givenSelectedCandidate,
  mutateCandidateRowContainers,
  productData,
  productFields,
  requireCandidateRowData,
  rowFields,
  schemaWith,
  sourceSchemaRowIdentity,
  sourceRowIntegrity,
} from './support/candidate-scenario';
import { CATALOGUE_TABLE_CREATED_ID } from 'src/features/draft-changes/__tests__/catalogue/support/catalogue-scenario';
import {
  numberField,
  objectSchema,
  rowInput,
  stringField,
} from 'src/features/draft-changes/__tests__/schema/support/schema-projection-fixture';

describe('draft changes candidate values', () => {
  it('restores Head data without requiring valid Draft history', async () => {
    const data = await givenRestoreHeadCandidate({
      headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head', price: 10 })],
      draftRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Draft', price: 20 })],
    });
    corruptDraftSchemaHistoryHash(data.snapshot);

    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    expect(result).toMatchObject({ migrationLedger: 'deferred' });
    expect(
      requireCandidateRowData(
        result,
        'draft',
        CATALOGUE_TABLE_CREATED_ID,
        CANDIDATE_ROW_ID,
      ),
    ).toEqual({ title: 'Head', price: 10 });
    expect(
      candidateSchemaRowIdentity(result, 'draft', CATALOGUE_TABLE_CREATED_ID),
    ).toEqual(
      sourceSchemaRowIdentity(
        data.snapshot,
        'head',
        CATALOGUE_TABLE_CREATED_ID,
      ),
    );
    expect(
      candidateRowIntegrity(
        result,
        'draft',
        CATALOGUE_TABLE_CREATED_ID,
        CANDIDATE_ROW_ID,
      ),
    ).toEqual(
      sourceRowIntegrity(
        data.snapshot,
        'head',
        CATALOGUE_TABLE_CREATED_ID,
        CANDIDATE_ROW_ID,
      ),
    );
  });

  it('repairs a stale data hash during explicit full restoration', async () => {
    const data = await givenRestoreHeadCandidate({
      headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head', price: 10 })],
      draftRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head', price: 10 })],
    });
    corruptDraftRowHash(
      data.snapshot,
      CATALOGUE_TABLE_CREATED_ID,
      CANDIDATE_ROW_ID,
    );

    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    expect(
      requireCandidateRowData(
        result,
        'draft',
        CATALOGUE_TABLE_CREATED_ID,
        CANDIDATE_ROW_ID,
      ),
    ).toEqual({ title: 'Head', price: 10 });
    expect(
      candidateRowIntegrity(
        result,
        'draft',
        CATALOGUE_TABLE_CREATED_ID,
        CANDIDATE_ROW_ID,
      ),
    ).toEqual(
      sourceRowIntegrity(
        data.snapshot,
        'head',
        CATALOGUE_TABLE_CREATED_ID,
        CANDIDATE_ROW_ID,
      ),
    );
  });

  it('restores an invalid selected Draft field while keeping the remaining state', async () => {
    const schema = schemaWith({
      title: stringField(),
      price: numberField(),
    });
    const { data } = await givenSelectedCandidate({
      operation: 'discard',
      selection: rowFields('products', CANDIDATE_ROW_ID, ['/title']),
      scenario: {
        headSchema: schema,
        draftSchema: schema,
        headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head', price: 10 })],
        draftRows: [rowInput(CANDIDATE_ROW_ID, { title: 42, price: 20 })],
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

  it('materializes the schema default when a selected value is null', async () => {
    const schema = schemaWith({ title: stringField('fallback') });
    const { data } = await givenSelectedCandidate({
      operation: 'commit',
      selection: rowFields('products', CANDIDATE_ROW_ID, ['/title']),
      scenario: {
        headSchema: schema,
        draftSchema: schema,
        headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head' })],
        draftRows: [rowInput(CANDIDATE_ROW_ID, { title: null })],
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
    ).toEqual({ title: 'fallback' });
    expect(productData(result, 'draft')).toEqual({ title: 'fallback' });
  });

  it('keeps an omitted optional property absent while applying another edit', async () => {
    const schema = schemaWith(
      { title: stringField(), note: stringField('default note') },
      ['title'],
    );
    const { data } = await givenSelectedCandidate({
      operation: 'commit',
      selection: productFields(['/title']),
      scenario: {
        headSchema: schema,
        draftSchema: schema,
        headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head' })],
        draftRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Draft' })],
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
    ).toEqual({ title: 'Draft' });
    expect(productData(result, 'head')).toEqual({ title: 'Draft' });
  });

  it('blocks a commit whose pending Draft data is invalid', async () => {
    const schema = schemaWith({
      title: stringField(),
      price: numberField(),
    });
    const { data } = await givenSelectedCandidate({
      operation: 'commit',
      selection: rowFields('products', CANDIDATE_ROW_ID, ['/title']),
      scenario: {
        headSchema: schema,
        draftSchema: schema,
        headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head', price: 10 })],
        draftRows: [
          rowInput(CANDIDATE_ROW_ID, { title: 'Draft', price: 'invalid' }),
        ],
      },
    });

    const result = await calculateCandidate(data);

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [
        expect.objectContaining({ code: 'INVALID_RESULT_DATA', role: 'draft' }),
      ],
    });
  });

  it('keeps unknown Draft data visible as a validation blocker', async () => {
    const schema = schemaWith({ title: stringField() });
    const { data } = await givenSelectedCandidate({
      operation: 'commit',
      selection: productFields(['/title']),
      scenario: {
        headSchema: schema,
        draftSchema: schema,
        headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head' })],
        draftRows: [
          rowInput(CANDIDATE_ROW_ID, {
            title: 'Draft',
            unknown: 'keep visible',
          }),
        ],
      },
    });

    const result = await calculateCandidate(data);

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [expect.objectContaining({ code: 'INVALID_RESULT_DATA' })],
    });
  });

  it('keeps the source snapshot detached from a calculated candidate', async () => {
    const schema = schemaWith({
      title: stringField(),
      nested: objectSchema({ value: stringField() }),
    });
    const { data } = await givenSelectedCandidate({
      operation: 'commit',
      selection: productFields(['/title']),
      scenario: {
        headSchema: schema,
        draftSchema: schema,
        headRows: [
          rowInput(CANDIDATE_ROW_ID, {
            title: 'Head',
            nested: { value: 'Head' },
          }),
        ],
        draftRows: [
          rowInput(CANDIDATE_ROW_ID, {
            title: 'Draft',
            nested: { value: 'Draft' },
          }),
        ],
      },
    });
    const originalSnapshot = structuredClone(data.snapshot);
    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    const draftBefore = structuredClone(
      candidateRowSnapshot(
        result,
        'draft',
        CATALOGUE_TABLE_CREATED_ID,
        CANDIDATE_ROW_ID,
      ),
    );
    mutateCandidateRowContainers(
      result,
      'head',
      CATALOGUE_TABLE_CREATED_ID,
      CANDIDATE_ROW_ID,
    );

    expect(data.snapshot).toEqual(originalSnapshot);
    expect(
      candidateRowSnapshot(
        result,
        'draft',
        CATALOGUE_TABLE_CREATED_ID,
        CANDIDATE_ROW_ID,
      ),
    ).toEqual(draftBefore);
  });

  it('returns independent Head and Draft row data', async () => {
    const { data } = await givenSelectedCandidate({ operation: 'commit' });
    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    replaceCandidateRowData(
      result,
      'head',
      CATALOGUE_TABLE_CREATED_ID,
      CANDIDATE_ROW_ID,
      { title: 'Head only', price: 1 },
    );

    expect(productData(result, 'draft')).toEqual({ title: 'Draft', price: 20 });
  });
});
