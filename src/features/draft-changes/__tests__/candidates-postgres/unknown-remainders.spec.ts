import { createPersistedCandidateTestKit } from './support/persisted-candidate-scenario';

describe('Draft Changes candidates: persisted unknown residual boundaries', () => {
  let kit: Awaited<ReturnType<typeof createPersistedCandidateTestKit>>;

  beforeAll(async () => {
    kit = await createPersistedCandidateTestKit();
  });
  afterAll(async () => {
    await kit?.close();
  });

  it.each([99, 10])(
    'blocks an unknown value that collides with the restored field name (price=%s)',
    async (price) => {
      const scenario = await kit.givenProduct();
      await scenario.renamePriceTwice();
      await scenario.retainCollidingUnknownPrice(price);

      const result = await scenario.calculateSchema('discard', [
        '/properties/amount',
      ]);

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
    },
  );

  it('blocks an unknown value in a renamed object with no schema-known children', async () => {
    const scenario = await kit.givenEmptyNestedProduct();
    await scenario.renameNestedParent();
    await scenario.retainEmptyObjectUnknownField();

    const result = await scenario.calculateSchema('discard', [
      '/properties/newParent',
    ]);

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
