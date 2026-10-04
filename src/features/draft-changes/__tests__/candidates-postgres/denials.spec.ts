import { createPersistedCandidateTestKit } from './support/persisted-candidate-scenario';

describe('Draft Changes candidates: persisted denied values', () => {
  let kit: Awaited<ReturnType<typeof createPersistedCandidateTestKit>>;

  beforeAll(async () => {
    kit = await createPersistedCandidateTestKit();
  });

  afterAll(async () => {
    await kit?.close();
  });

  it('preserves whole-row exclusion during schema removal', async () => {
    const scenario = await kit.givenProduct();
    await scenario.removePrice();

    const result = await scenario.calculate('commit', {
      include: [
        {
          kind: 'schemaFields',
          tableId: 'products',
          paths: ['/properties/price'],
        },
      ],
      exclude: [{ kind: 'rows', tableId: 'products', rowIds: ['product'] }],
    });

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [expect.objectContaining({ code: 'EXCLUDED_PREREQUISITE' })],
    });
  });

  it('keeps unselected unknown values visible to validation after schema discard', async () => {
    const scenario = await kit.givenProduct();
    await scenario.addDefaultField();
    await scenario.retainUnknownField();

    const result = await scenario.calculateSchema('discard', [
      '/properties/extra',
    ]);

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [
        expect.objectContaining({
          code: 'SCHEMA_PROJECTION_BLOCKED',
          role: 'draft',
          schemaBlocker: expect.objectContaining({
            code: 'UNREPRESENTABLE_REMAINDER',
          }),
        }),
      ],
    });
  });
});
