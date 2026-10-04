import { createPersistedCatalogueTestKit } from './support/persisted-catalogue-scenario';

describe('Draft Changes catalogue: ancestor selection', () => {
  let kit: Awaited<ReturnType<typeof createPersistedCatalogueTestKit>>;

  beforeAll(async () => {
    kit = await createPersistedCatalogueTestKit();
  });

  afterAll(async () => {
    await kit?.close();
  });

  it('keeps a later ancestor rename outside the child-owned effects', async () => {
    const scenario = await kit.givenNestedProduct();
    await scenario.editNestedChild();
    await scenario.renameNestedParent();

    const catalogue = await scenario.catalogue();

    expect(catalogue.entries).toContainEqual(
      expect.objectContaining({
        kind: 'schemaField',
        path: '/properties/newParent/properties/child',
        effectRefs: [{ historyIndex: 1, patchIndex: 0 }],
      }),
    );
  });

  it('keeps an earlier ancestor rename outside the child-owned effects', async () => {
    const scenario = await kit.givenNestedProduct();
    await scenario.renameNestedParent();
    await scenario.editNestedChild('newParent');

    const catalogue = await scenario.catalogue();

    expect(catalogue.entries).toContainEqual(
      expect.objectContaining({
        kind: 'schemaField',
        path: '/properties/newParent/properties/child',
        effectRefs: [{ historyIndex: 2, patchIndex: 0 }],
      }),
    );
  });

  it('projects a child edit while leaving the later parent rename pending', async () => {
    const scenario = await kit.givenNestedProduct();
    await scenario.editNestedChild();
    await scenario.renameNestedParent();

    const projection = await scenario.projectNestedChild();

    expect(projection).toMatchObject({
      status: 'projected',
      selectedEffects: [{ historyIndex: 1, patchIndex: 0 }],
      head: {
        schema: {
          properties: {
            oldParent: {
              properties: { child: { type: 'number' } },
            },
          },
        },
      },
      draft: {
        schema: {
          properties: {
            newParent: {
              properties: { child: { type: 'number' } },
            },
          },
        },
      },
    });
  });
});
