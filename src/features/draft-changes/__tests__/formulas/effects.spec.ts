import {
  candidateSchema,
  candidateState,
  createFormulaCandidateOperation,
  formulaField,
  requireRecomputed,
} from './support/formula-candidate';

describe('Draft Changes candidate formulas: effects', () => {
  let operation: Awaited<ReturnType<typeof createFormulaCandidateOperation>>;

  beforeAll(async () => {
    operation = await createFormulaCandidateOperation();
  });

  afterAll(async () => operation.close());

  it('distinguishes a missing value from an existing null value', async () => {
    const schema = candidateSchema({
      price: { type: 'number', default: 0 },
      total: formulaField('number', 'price * 2', 0),
    });
    const absent = candidateState({ schema, data: { price: 4 } });
    const explicitNull = candidateState({
      schema,
      data: { price: 4, total: null },
    });

    const result = requireRecomputed(
      await operation.recompute({ head: absent, draft: explicitNull }),
    );

    expect(result.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'head',
          path: '/total',
          beforeExists: false,
          afterExists: true,
          after: 8,
        }),
        expect.objectContaining({
          role: 'draft',
          path: '/total',
          beforeExists: true,
          before: null,
          afterExists: true,
          after: 8,
        }),
      ]),
    );
  });

  it('does not report an effect when the computed value is already current', async () => {
    const schema = candidateSchema({
      price: { type: 'number', default: 0 },
      total: formulaField('number', 'price * 2', 0),
    });
    const state = candidateState({ schema, data: { price: 4, total: 8 } });

    const result = requireRecomputed(
      await operation.recompute({ head: state, draft: state }),
    );

    expect(result.effects).toEqual([]);
  });
});
