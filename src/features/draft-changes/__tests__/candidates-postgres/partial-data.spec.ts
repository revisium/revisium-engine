import {
  createPersistedCandidateTestKit,
  productStates,
} from './support/persisted-candidate-scenario';

describe('Draft Changes candidates: persisted partial data', () => {
  let kit: Awaited<ReturnType<typeof createPersistedCandidateTestKit>>;

  beforeAll(async () => {
    kit = await createPersistedCandidateTestKit();
  });

  afterAll(async () => {
    await kit?.close();
  });

  it('commits one field while leaving an independent edit pending', async () => {
    const scenario = await kit.givenProduct();
    await scenario.editBothFields();

    const result = await scenario.calculateFields('commit', ['/title']);

    expect(productStates(result)).toEqual({
      head: { price: 10, title: 'Draft' },
      draft: { price: 25, title: 'Draft' },
    });
  });

  it('discards one field while preserving an independent edit', async () => {
    const scenario = await kit.givenProduct();
    await scenario.editBothFields();

    const result = await scenario.calculateFields('discard', ['/title']);

    expect(productStates(result)).toEqual({
      head: { price: 10, title: 'Head' },
      draft: { price: 25, title: 'Head' },
    });
  });

  it('preserves an excluded child of a selected object', async () => {
    const scenario = await kit.givenProduct();
    await scenario.editBothFields();

    const result = await scenario.calculateFields('commit', [''], ['/price']);

    expect(productStates(result)).toEqual({
      head: { price: 10, title: 'Draft' },
      draft: { price: 25, title: 'Draft' },
    });
  });

  it('does not write the calculated states to PostgreSQL', async () => {
    const scenario = await kit.givenProduct();
    await scenario.editBothFields();
    const before = await scenario.readSnapshot();

    const result = await scenario.calculateFields('commit', ['/title']);

    expect(result).toMatchObject({
      status: 'calculated',
      migrationLedger: 'deferred',
    });
    expect(await scenario.readSnapshot()).toEqual(before);
  });
});
