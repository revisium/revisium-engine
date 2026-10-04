import {
  createPersistedCandidateTestKit,
  productStates,
} from './support/persisted-candidate-scenario';

describe('Draft Changes candidates: persisted schema and data', () => {
  let kit: Awaited<ReturnType<typeof createPersistedCandidateTestKit>>;

  beforeAll(async () => {
    kit = await createPersistedCandidateTestKit();
  });

  afterAll(async () => {
    await kit?.close();
  });

  it('commits schema defaults without publishing an independent row edit', async () => {
    const scenario = await kit.givenProduct();
    await scenario.editTitle('Draft');
    await scenario.addDefaultField();

    const result = await scenario.calculateSchema('commit', [
      '/properties/extra',
    ]);

    expect(productStates(result)).toEqual({
      head: { price: 10, title: 'Head', extra: 0 },
      draft: { price: 10, title: 'Draft', extra: 0 },
    });
  });

  it('commits renamed schema while retaining its independent value edit', async () => {
    const scenario = await kit.givenProduct();
    await scenario.renamePriceTwice();
    await scenario.editAmount();

    const result = await scenario.calculateSchema('commit', [
      '/properties/amount',
    ]);

    expect(productStates(result)).toEqual({
      head: { amount: 10, title: 'Head' },
      draft: { amount: 25, title: 'Head' },
    });
  });

  it('requires the original schema effect for a newly added field value', async () => {
    const scenario = await kit.givenProduct();
    await scenario.addDefaultField();
    await scenario.setExtraValue();

    const result = await scenario.calculateFields('commit', ['/extra']);

    expect(result).toMatchObject({
      status: 'needsEffects',
      requirements: [
        expect.objectContaining({
          kind: 'schemaEffects',
          role: 'head',
          effects: [{ historyIndex: 1, patchIndex: 0 }],
        }),
      ],
    });
  });

  it('requires independent data removal before discarding its schema', async () => {
    const scenario = await kit.givenProduct();
    await scenario.addDefaultField();
    await scenario.setExtraValue();

    const result = await scenario.calculateSchema('discard', [
      '/properties/extra',
    ]);

    expect(result).toMatchObject({
      status: 'needsEffects',
      requirements: [
        expect.objectContaining({
          kind: 'discardDataFields',
          role: 'draft',
          fields: [expect.objectContaining({ path: '/extra' })],
        }),
      ],
    });
  });

  it('removes an invalid created row together with its selected schema', async () => {
    const scenario = await kit.givenProduct();
    await scenario.addDefaultField();
    await scenario.addInvalidRow();

    const result = await scenario.calculate('discard', {
      include: [
        {
          kind: 'schemaFields',
          tableId: 'products',
          paths: ['/properties/extra'],
        },
        { kind: 'rows', tableId: 'products', rowIds: ['invalid'] },
      ],
    });

    expect(productStates(result)).toEqual({
      head: { price: 10, title: 'Head' },
      draft: { price: 10, title: 'Head' },
    });
  });

  it('blocks schema removal that changes an excluded Head value', async () => {
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
      exclude: [
        {
          kind: 'rowFields',
          tableId: 'products',
          rowId: 'product',
          paths: ['/price'],
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [expect.objectContaining({ code: 'EXCLUDED_PREREQUISITE' })],
    });
  });
});
