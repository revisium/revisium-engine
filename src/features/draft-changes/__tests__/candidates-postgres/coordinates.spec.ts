import {
  createPersistedCandidateTestKit,
  productStates,
} from './support/persisted-candidate-scenario';

describe('Draft Changes candidates: persisted field coordinates', () => {
  let kit: Awaited<ReturnType<typeof createPersistedCandidateTestKit>>;

  beforeAll(async () => {
    kit = await createPersistedCandidateTestKit();
  });
  afterAll(async () => {
    await kit?.close();
  });

  it('restores a renamed required value in retained schema coordinates', async () => {
    const scenario = await kit.givenProduct();
    await scenario.renamePriceTwice();
    await scenario.editRenamedPriceKeepingTitle();

    const result = await scenario.calculate('discard', {
      include: [
        {
          kind: 'schemaFields',
          tableId: 'products',
          paths: ['/properties/amount'],
        },
        {
          kind: 'rowFields',
          tableId: 'products',
          rowId: 'product',
          paths: ['/amount'],
        },
      ],
    });

    expect(productStates(result)).toEqual({
      head: { price: 10, title: 'Head' },
      draft: { price: 10, title: 'Draft' },
    });
  });

  it('restores a renamed optional value without losing its original presence', async () => {
    const scenario = await kit.givenOptionalPriceProduct();
    await scenario.renamePriceTwice();
    await scenario.editRenamedPriceKeepingTitle();

    const result = await scenario.calculate('discard', {
      include: [
        {
          kind: 'schemaFields',
          tableId: 'products',
          paths: ['/properties/amount'],
        },
        {
          kind: 'rowFields',
          tableId: 'products',
          rowId: 'product',
          paths: ['/amount'],
        },
      ],
    });

    expect(productStates(result)).toEqual({
      head: { price: 10, title: 'Head' },
      draft: { price: 10, title: 'Draft' },
    });
  });

  it('enforces a denied current field when its ancestor rename stays pending', async () => {
    const scenario = await kit.givenNestedProduct();
    await scenario.changeNestedChildType();
    await scenario.renameNestedParent();
    await scenario.editNestedChild(true);

    const result = await scenario.calculate('commit', {
      include: [
        {
          kind: 'schemaFields',
          tableId: 'products',
          paths: ['/properties/newParent/properties/child'],
        },
      ],
      exclude: [
        {
          kind: 'rowFields',
          tableId: 'products',
          rowId: 'product',
          paths: ['/newParent/child'],
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [expect.objectContaining({ code: 'EXCLUDED_PREREQUISITE' })],
    });
  });

  it('enforces an exact excluded field reference during a schema type change', async () => {
    const scenario = await kit.givenNestedProduct();
    await scenario.changeNestedChildType();
    await scenario.editNestedChild(false);
    const excluded = await scenario.fieldReference('/oldParent/child');

    const result = await scenario.calculate('commit', {
      include: [
        {
          kind: 'schemaFields',
          tableId: 'products',
          paths: ['/properties/oldParent/properties/child'],
        },
      ],
      exclude: [{ kind: 'change', ref: excluded }],
    });

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [expect.objectContaining({ code: 'EXCLUDED_PREREQUISITE' })],
    });
  });

  it('blocks an unknown nested remainder instead of erasing it during schema rename discard', async () => {
    const scenario = await kit.givenNestedProduct();
    await scenario.renameNestedParent();
    await scenario.retainRenamedUnknownField();

    const result = await scenario.calculateSchema('discard', [
      '/properties/newParent',
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
