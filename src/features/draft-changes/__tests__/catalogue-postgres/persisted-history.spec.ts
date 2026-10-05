import { createPersistedCatalogueTestKit } from './support/persisted-catalogue-scenario';

describe('Draft Changes catalogue: persisted history', () => {
  let kit: Awaited<ReturnType<typeof createPersistedCatalogueTestKit>>;
  beforeAll(async () => {
    kit = await createPersistedCatalogueTestKit();
  });
  afterAll(async () => {
    await kit?.close();
  });

  it('preserves recorded patch coordinates through a rename chain', async () => {
    const scenario = await kit.givenProduct();
    await scenario.renamePriceTwice();

    const catalogue = await scenario.catalogue();

    expect(catalogue.entries).toContainEqual(
      expect.objectContaining({
        kind: 'schemaField',
        path: '/properties/amount',
        previousPath: '/properties/price',
        effectRefs: [
          { historyIndex: 1, patchIndex: 0 },
          { historyIndex: 2, patchIndex: 0 },
        ],
      }),
    );
  });

  it('compares an independent value with its migrated Head baseline', async () => {
    const scenario = await kit.givenProduct();
    await scenario.renamePriceTwice();
    await scenario.editAmount();

    const catalogue = await scenario.catalogue();

    expect(catalogue.entries.filter(({ kind }) => kind === 'rowField')).toEqual(
      [expect.objectContaining({ path: '/amount', before: 10, after: 25 })],
    );
  });

  it('compares actual Draft values when supplied a legal discard projection', async () => {
    const scenario = await kit.givenProduct();
    await scenario.renamePriceTwice();
    await scenario.editAmount();

    const catalogue = await scenario.catalogueFromDiscardProjection();

    expect(catalogue.entries.filter(({ kind }) => kind === 'rowField')).toEqual(
      [expect.objectContaining({ path: '/amount', before: 10, after: 25 })],
    );
  });

  it('shows an added schema field at its terminal renamed coordinate', async () => {
    const scenario = await kit.givenProduct();
    await scenario.addAndRenameExtra();

    const catalogue = await scenario.catalogue();

    expect(
      catalogue.entries.filter(
        ({ kind, classification }) =>
          kind === 'schemaField' && classification === 'created',
      ),
    ).toEqual([
      expect.objectContaining({
        path: '/properties/renamed',
        effectRefs: expect.arrayContaining([
          { historyIndex: 1, patchIndex: 0 },
        ]),
      }),
    ]);
  });

  it('keeps a deleted schema identity absent after its public path is reused', async () => {
    const scenario = await kit.givenProduct();
    await scenario.recreateTitleAsNumber();

    const catalogue = await scenario.catalogue();

    expect(catalogue.entries).toContainEqual(
      expect.objectContaining({
        kind: 'schemaField',
        classification: 'deleted',
        path: '/properties/title',
        before: expect.objectContaining({ type: 'string' }),
        afterExists: false,
        effectRefs: [{ historyIndex: 1, patchIndex: 0 }],
      }),
    );
  });

  it('selects recorded schema changes using schema JSON Pointers', async () => {
    const scenario = await kit.givenProduct();
    await scenario.renamePriceTwice();

    expect(
      await scenario.selectSchemaFields(['/properties/amount']),
    ).toMatchObject({
      status: 'resolved',
      selected: [
        expect.objectContaining({
          kind: 'schemaField',
          path: '/properties/amount',
        }),
      ],
    });
  });

  it('does not classify schema default materialization as a row edit', async () => {
    const scenario = await kit.givenProduct();
    await scenario.addDefaultField();

    const catalogue = await scenario.catalogue();

    expect(catalogue.entries.filter(({ kind }) => kind === 'rowField')).toEqual(
      [],
    );
  });

  it('finds an actual value edit when persisted hash metadata is unchanged', async () => {
    const scenario = await kit.givenProduct();
    await scenario.tamperTitleKeepingHash('Unrecorded');

    const catalogue = await scenario.catalogue();

    expect(catalogue.entries).toContainEqual(
      expect.objectContaining({
        kind: 'rowField',
        path: '/title',
        before: 'Head',
        after: 'Unrecorded',
      }),
    );
  });

  it('leaves persisted state unchanged after catalogue and selection', async () => {
    const scenario = await kit.givenProduct();
    await scenario.editTitle('Draft');
    const before = await scenario.readSnapshot();

    await scenario.selectRows();

    expect(await scenario.readSnapshot()).toEqual(before);
  });
});
