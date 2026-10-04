import { createPersistedCandidateTestKit } from './support/persisted-candidate-scenario';

describe('Draft Changes candidates: persisted lifecycle', () => {
  let kit: Awaited<ReturnType<typeof createPersistedCandidateTestKit>>;

  beforeAll(async () => {
    kit = await createPersistedCandidateTestKit();
  });

  afterAll(async () => {
    await kit?.close();
  });

  it('requires table creation for one selected row in a new table', async () => {
    const scenario = await kit.givenProduct();
    await scenario.createTableWithSiblingRows();

    const result = await scenario.calculate('commit', {
      include: [{ kind: 'rows', tableId: 'extras', rowIds: ['selected'] }],
    });

    expect(result).toMatchObject({
      status: 'needsEffects',
      requirements: [
        expect.objectContaining({ kind: 'catalogueEffects', role: 'head' }),
      ],
    });
  });
});
