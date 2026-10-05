import {
  createPersistedCandidateTestKit,
  productStates,
  candidateTableRows,
} from './support/persisted-candidate-scenario';

describe('Draft Changes candidates: persisted independent exclusions', () => {
  let kit: Awaited<ReturnType<typeof createPersistedCandidateTestKit>>;

  beforeAll(async () => {
    kit = await createPersistedCandidateTestKit();
  });
  afterAll(async () => {
    await kit?.close();
  });

  it('discards an independent value while a denied renamed value remains unchanged', async () => {
    const scenario = await kit.givenProduct();
    await scenario.renamePriceTwice();
    await scenario.editRenamedPriceKeepingTitle();

    const result = await scenario.calculateFields(
      'discard',
      ['/title'],
      ['/amount'],
    );

    expect(productStates(result)).toEqual({
      head: { price: 10, title: 'Head' },
      draft: { amount: 25, title: 'Head' },
    });
  });

  it('publishes a created row while an exact excluded table rename remains pending', async () => {
    const scenario = await kit.givenProduct();
    await scenario.renameTableAndCreateRow();
    const excluded = await scenario.tableRenameReference();

    const result = await scenario.calculate('commit', {
      include: [{ kind: 'rows', tableId: 'renamed-products', rowIds: ['new'] }],
      exclude: [{ kind: 'change', ref: excluded }],
    });

    expect(candidateTableRows(result, 'head', 'products')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'new',
          data: { price: 0, title: 'New' },
        }),
      ]),
    );
    expect(candidateTableRows(result, 'draft', 'renamed-products')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'new',
          data: { price: 0, title: 'New' },
        }),
      ]),
    );
  });

  it('publishes an independent value while an exact excluded schema rename remains pending', async () => {
    const scenario = await kit.givenProduct();
    await scenario.renamePriceTwice();
    await scenario.editRenamedPriceKeepingTitle();
    const excluded = await scenario.schemaRenameReference();

    const result = await scenario.calculate('commit', {
      include: [
        {
          kind: 'rowFields',
          tableId: 'products',
          rowId: 'product',
          paths: ['/title'],
        },
      ],
      exclude: [{ kind: 'change', ref: excluded }],
    });

    expect(productStates(result)).toEqual({
      head: { price: 10, title: 'Draft' },
      draft: { amount: 25, title: 'Draft' },
    });
  });

  it('publishes a child schema effect while the exact parent rename stays excluded', async () => {
    const scenario = await kit.givenNestedProduct();
    await scenario.changeNestedChildType();
    await scenario.renameNestedParent();
    await scenario.editNestedChild(true);
    const excluded = await scenario.schemaRenameReference();

    const result = await scenario.calculate('commit', {
      include: [
        {
          kind: 'schemaFields',
          tableId: 'products',
          paths: ['/properties/newParent/properties/child'],
        },
      ],
      exclude: [{ kind: 'change', ref: excluded }],
    });

    expect(productStates(result)).toEqual({
      head: { oldParent: { child: 0, sibling: 'S' } },
      draft: { newParent: { child: 7, sibling: 'S' } },
    });
  });
});
