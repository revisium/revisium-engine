import {
  createPersistedCandidateTestKit,
  productStates,
} from './support/persisted-candidate-scenario';

describe('Draft Changes candidates: persisted optional values', () => {
  let kit: Awaited<ReturnType<typeof createPersistedCandidateTestKit>>;

  beforeAll(async () => {
    kit = await createPersistedCandidateTestKit();
  });

  afterAll(async () => {
    await kit?.close();
  });

  it('commits optional property removal without materializing its default', async () => {
    const scenario = await kit.givenOptionalProduct();
    await scenario.omitNote();

    const result = await scenario.calculateFields('commit', ['/note']);

    expect(productStates(result)).toEqual({
      head: { price: 10, title: 'Head' },
      draft: { price: 10, title: 'Head' },
    });
  });
});
