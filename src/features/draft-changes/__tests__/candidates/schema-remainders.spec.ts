import {
  calculateCandidate,
  CANDIDATE_ROW_ID,
  givenSelectedCandidate,
  givenRenamedInvalidDraftRemainder,
  givenDiscardWithCollidingRenamedRemainder,
  givenDiscardWithEqualCollidingRenamedRemainder,
  requireCandidateBlocked,
  schemaFields,
  schemaWith,
} from './support/candidate-scenario';
import {
  addField,
  numberField,
  rowInput,
  stringField,
  givenSchemaPatchGroups,
} from 'src/features/draft-changes/__tests__/schema/support/schema-projection-fixture';

describe('draft changes candidate schema remainders', () => {
  it('keeps unknown Draft data visible when discarding a schema rename', async () => {
    const { data } = await givenRenamedInvalidDraftRemainder();

    const result = await calculateCandidate(data);
    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [
        expect.objectContaining({
          code: 'SCHEMA_PROJECTION_BLOCKED',
          schemaBlocker: expect.objectContaining({
            code: 'UNREPRESENTABLE_REMAINDER',
            rowCreatedId: CANDIDATE_ROW_ID,
          }),
        }),
      ],
    });
    expect(
      requireCandidateBlocked(result).blockers[0]?.schemaBlocker,
    ).not.toHaveProperty('requiredDataFields');
  });

  it('does not erase invalid unknown Draft data during a selected schema discard', async () => {
    const headSchema = schemaWith({ title: stringField() });
    const added = givenSchemaPatchGroups(headSchema, [
      [addField('/properties/extra', numberField())],
    ]);
    const { data } = await givenSelectedCandidate({
      operation: 'discard',
      selection: schemaFields('products', ['/properties/extra']),
      scenario: {
        headSchema,
        draftSchema: added.terminalSchema,
        pending: added.steps,
        headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head' })],
        draftRows: [
          rowInput(CANDIDATE_ROW_ID, {
            title: 'Draft',
            extra: 0,
            rogue: true,
          }),
        ],
      },
    });

    const result = await calculateCandidate(data);

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [
        expect.objectContaining({ code: 'SCHEMA_PROJECTION_BLOCKED' }),
      ],
    });
  });

  it('blocks when an unknown Draft value collides with the restored renamed field', async () => {
    const data = await givenDiscardWithCollidingRenamedRemainder();

    const result = await calculateCandidate(data);

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [
        expect.objectContaining({
          code: 'SCHEMA_PROJECTION_BLOCKED',
          schemaBlocker: expect.objectContaining({
            code: 'UNREPRESENTABLE_REMAINDER',
          }),
        }),
      ],
    });
  });

  it('blocks an equal-valued unknown Draft property colliding with a restored field', async () => {
    const data = await givenDiscardWithEqualCollidingRenamedRemainder();

    const result = await calculateCandidate(data);

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [
        expect.objectContaining({
          code: 'SCHEMA_PROJECTION_BLOCKED',
          schemaBlocker: expect.objectContaining({
            code: 'UNREPRESENTABLE_REMAINDER',
          }),
        }),
      ],
    });
  });
});
