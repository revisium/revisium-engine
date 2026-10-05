import {
  calculateCandidate,
  changeCandidateBranch,
  changeCandidateDraftRevision,
  CANDIDATE_ROW_ID,
  givenSelectedCandidate,
  productData,
  productFields,
  replaceFirstSelectedReference,
  replaceFirstSelectedPayload,
  schemaWith,
  setCandidateCatalogueFingerprint,
} from './support/candidate-scenario';
import {
  addField,
  numberField,
  givenSchemaPatchGroups,
  rowInput,
  stringField,
} from 'src/features/draft-changes/__tests__/schema/support/schema-projection-fixture';

describe('draft changes candidate selection scope', () => {
  it('keeps an empty selected calculation a no-op rather than a Head restore', async () => {
    const { data } = await givenSelectedCandidate({
      operation: 'discard',
      selection: { include: [] },
      scenario: {
        headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head', price: 10 })],
        draftRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Draft', price: 20 })],
      },
    });

    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    expect(productData(result, 'head')).toEqual({ title: 'Head', price: 10 });
    expect(productData(result, 'draft')).toEqual({ title: 'Draft', price: 20 });
  });

  it('validates both unchanged roles when nothing is selected', async () => {
    const invalid = { title: 'Same', price: 'not-a-number' };
    const { data } = await givenSelectedCandidate({
      operation: 'commit',
      selection: { include: [] },
      scenario: {
        headRows: [rowInput(CANDIDATE_ROW_ID, invalid)],
        draftRows: [rowInput(CANDIDATE_ROW_ID, invalid)],
      },
    });

    const result = await calculateCandidate(data);

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [
        expect.objectContaining({ code: 'INVALID_RESULT_DATA', role: 'head' }),
        expect.objectContaining({ code: 'INVALID_RESULT_DATA', role: 'draft' }),
      ],
    });
  });

  it('rejects a catalogue from a different fingerprint scope', async () => {
    const { data } = await givenSelectedCandidate({
      operation: 'commit',
      selection: productFields(['/title']),
      scenario: {
        headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head', price: 10 })],
        draftRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Draft', price: 10 })],
      },
    });
    setCandidateCatalogueFingerprint(data, 'stale-fingerprint');

    const result = await calculateCandidate(data);

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [expect.objectContaining({ code: 'SCOPE_MISMATCH' })],
    });
  });

  it('rejects a selected reference that does not resolve to a canonical entry', async () => {
    const { data } = await givenSelectedCandidate({
      operation: 'commit',
      selection: productFields(['/title']),
      scenario: {
        headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head', price: 10 })],
        draftRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Draft', price: 10 })],
      },
    });
    replaceFirstSelectedReference(data, 'forged-reference');

    const result = await calculateCandidate(data);

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [expect.objectContaining({ code: 'INVALID_SELECTION' })],
    });
  });

  it('rejects caller-modified selected entry data even when its ref is unchanged', async () => {
    const { data } = await givenSelectedCandidate({
      operation: 'commit',
      selection: productFields(['/title']),
      scenario: {
        headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head', price: 10 })],
        draftRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Draft', price: 10 })],
      },
    });
    replaceFirstSelectedPayload(data);

    const result = await calculateCandidate(data);

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [expect.objectContaining({ code: 'INVALID_SELECTION' })],
    });
  });

  it('rejects a catalogue after the snapshot branch changes', async () => {
    const { data } = await givenSelectedCandidate({
      operation: 'commit',
      selection: productFields(['/title']),
      scenario: {
        headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head', price: 10 })],
        draftRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Draft', price: 10 })],
      },
    });
    changeCandidateBranch(data);

    const result = await calculateCandidate(data);

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [expect.objectContaining({ code: 'SCOPE_MISMATCH' })],
    });
  });

  it('rejects a catalogue after the Draft role changes', async () => {
    const { data } = await givenSelectedCandidate({
      operation: 'commit',
      selection: productFields(['/title']),
      scenario: {
        headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head', price: 10 })],
        draftRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Draft', price: 10 })],
      },
    });
    changeCandidateDraftRevision(data);

    const result = await calculateCandidate(data);

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [expect.objectContaining({ code: 'SCOPE_MISMATCH' })],
    });
  });

  it('blocks a hard-denied schema prerequisite for a selected new-field value', async () => {
    const headSchema = schemaWith({ title: stringField() });
    const added = givenSchemaPatchGroups(headSchema, [
      [addField('/properties/extra', numberField())],
    ]);
    const { data } = await givenSelectedCandidate({
      operation: 'commit',
      selection: {
        include: [
          {
            kind: 'rowFields',
            tableId: 'products',
            rowId: CANDIDATE_ROW_ID,
            paths: ['/extra'],
          },
        ],
        exclude: [
          {
            kind: 'schemaFields',
            tableId: 'products',
            paths: ['/properties/extra'],
          },
        ],
      },
      scenario: {
        headSchema,
        draftSchema: added.terminalSchema,
        pending: added.steps,
        headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head' })],
        draftRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Draft', extra: 4 })],
      },
    });

    const result = await calculateCandidate(data);

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [expect.objectContaining({ code: 'EXCLUDED_PREREQUISITE' })],
    });
  });
});
