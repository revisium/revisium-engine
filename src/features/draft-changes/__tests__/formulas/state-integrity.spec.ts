import objectHash from 'object-hash';
import {
  candidateSchema,
  candidateRowByIdentity,
  candidateState,
  createFormulaCandidateOperation,
  formulaField,
  requireRecomputed,
  stateRowByIdentity,
} from './support/formula-candidate';

describe('Draft Changes candidate formulas: state integrity', () => {
  let operation: Awaited<ReturnType<typeof createFormulaCandidateOperation>>;

  beforeAll(async () => {
    operation = await createFormulaCandidateOperation();
  });

  afterAll(async () => operation.close());

  it('refreshes hashes and editability when a computed value changes', async () => {
    const schema = candidateSchema({
      price: { type: 'number', default: 0 },
      total: formulaField('number', 'price * 2', 0),
    });
    const state = candidateState({
      schema,
      data: { price: 6, total: 0 },
    });
    const result = requireRecomputed(
      await operation.recompute({ head: state, draft: state }),
    );
    const row = candidateRowByIdentity(result, 'head');

    expect(row.data).toEqual({ price: 6, total: 12 });
    expect(row.hash).toBe(objectHash(row.data));
    expect(row.schemaHash).toBe(objectHash(schema));
    expect(row.readonly).toBe(false);
  });

  it('preserves user data, metadata, files, and dates', async () => {
    const schema = candidateSchema({
      price: { type: 'number', default: 0 },
      total: formulaField('number', 'price * 2', 0),
      title: { type: 'string', default: '' },
      nested: {
        type: 'object',
        properties: { note: { type: 'string', default: '' } },
        required: ['note'],
        additionalProperties: false,
      },
    });
    const state = candidateState({
      schema,
      data: {
        price: 6,
        title: 'User value',
        total: 0,
        nested: { note: 'Original' },
      },
    });
    const row = stateRowByIdentity(state);
    row.fileBlobs = [{ id: 'file-1' }];
    const before = structuredClone(row);
    const result = requireRecomputed(
      await operation.recompute({ head: state, draft: state }),
    );
    const calculated = candidateRowByIdentity(result, 'head');

    expect(calculated.data).toEqual({
      price: 6,
      title: 'User value',
      total: 12,
      nested: { note: 'Original' },
    });
    expect(calculated.id).toBe(before.id);
    expect(calculated.createdId).toBe(before.createdId);
    expect(calculated.versionId).toBe(before.versionId);
    expect(calculated.meta).toEqual(before.meta);
    expect(calculated.fileBlobs).toEqual(before.fileBlobs);
    expect(calculated.createdAt).toEqual(before.createdAt);
    expect(calculated.updatedAt).toEqual(before.updatedAt);
    expect(calculated.publishedAt).toEqual(before.publishedAt);
    expect(calculated.data).toMatchObject({ nested: { note: 'Original' } });
    operation.mutateNestedNote(result, 'head', 'Mutated result');
    expect(stateRowByIdentity(state).data).toMatchObject({
      nested: { note: 'Original' },
    });
  });
});
