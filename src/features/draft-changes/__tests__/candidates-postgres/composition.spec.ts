import {
  getArraySchema,
  getNumberSchema,
  getObjectSchema,
} from '@revisium/schema-toolkit/mocks';
import {
  createPersistedCandidateTestKit,
  productStates,
} from './support/persisted-candidate-scenario';

describe('Draft Changes candidates: persisted schema and value composition', () => {
  let kit: Awaited<ReturnType<typeof createPersistedCandidateTestKit>>;

  beforeAll(async () => {
    kit = await createPersistedCandidateTestKit();
  });

  afterAll(async () => {
    await kit?.close();
  });

  it('discards an atomic array value using the retained schema baseline', async () => {
    const scenario = await kit.givenProduct(
      getObjectSchema({
        items: getArraySchema(getObjectSchema({ price: getNumberSchema() })),
      }),
      { items: [{ price: 10 }] },
    );
    await scenario.addArrayField();
    await scenario.editArrayValues();

    const result = await scenario.calculate('discard', {
      include: [
        {
          kind: 'schemaFields',
          tableId: 'products',
          paths: ['/properties/items/items/properties/extra'],
        },
        {
          kind: 'rowFields',
          tableId: 'products',
          rowId: 'product',
          paths: ['/items'],
        },
      ],
    });

    expect(productStates(result)).toEqual({
      head: { items: [{ price: 10 }] },
      draft: { items: [{ price: 10 }] },
    });
  });

  it('requires the added field schema before publishing a new row that uses it', async () => {
    const scenario = await kit.givenProduct();
    await scenario.addDefaultField();
    await scenario.createExtraRow();

    const result = await scenario.calculate('commit', {
      include: [{ kind: 'rows', tableId: 'products', rowIds: ['new'] }],
    });

    expect(result).toMatchObject({
      status: 'needsEffects',
      requirements: [
        expect.objectContaining({
          kind: 'schemaEffects',
          effects: [{ historyIndex: 1, patchIndex: 0 }],
        }),
      ],
    });
  });

  it('requires an added object schema before publishing its child value', async () => {
    const scenario = await kit.givenProduct();
    await scenario.addObjectField();
    await scenario.editObjectChild();

    const result = await scenario.calculateFields('commit', ['/new/x']);

    expect(result).toMatchObject({
      status: 'needsEffects',
      requirements: [expect.objectContaining({ kind: 'schemaEffects' })],
    });
  });

  it('requires only the field addition without its independent description', async () => {
    const scenario = await kit.givenProduct();
    await scenario.addDefaultField();
    await scenario.editExtraDescription();
    await scenario.setExtraValue();

    const result = await scenario.calculateFields('commit', ['/extra']);

    expect(result).toMatchObject({
      status: 'needsEffects',
      requirements: [
        expect.objectContaining({
          kind: 'schemaEffects',
          effects: [{ historyIndex: 1, patchIndex: 0 }],
        }),
      ],
    });
  });
});
