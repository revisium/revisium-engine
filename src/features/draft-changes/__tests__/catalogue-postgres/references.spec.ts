import { createPersistedCatalogueTestKit } from './support/persisted-catalogue-scenario';

describe('Draft Changes catalogue: persisted references', () => {
  let kit: Awaited<ReturnType<typeof createPersistedCatalogueTestKit>>;
  beforeAll(async () => {
    kit = await createPersistedCatalogueTestKit();
  });
  afterAll(async () => {
    await kit?.close();
  });

  it('rejects a public row ID reused by a different identity', async () => {
    const scenario = await kit.givenProduct();
    await scenario.replaceRowIdentity();

    expect(await scenario.selectRows()).toMatchObject({
      status: 'blocked',
      blockers: [expect.objectContaining({ code: 'AMBIGUOUS_IDENTITY' })],
    });
  });

  it('selects exactly one identity through an opaque reference', async () => {
    const scenario = await kit.givenProduct();
    await scenario.replaceRowIdentity();
    const ref = await scenario.createdRowReference();

    expect(await scenario.selectRef(ref)).toMatchObject({
      status: 'resolved',
      selected: [expect.objectContaining({ classification: 'created' })],
    });
  });

  it('rejects a reference after an ordinary API edit changes the snapshot', async () => {
    const scenario = await kit.givenProduct();
    await scenario.editTitle('First');
    const ref = await scenario.rowFieldReference();
    await scenario.editTitle('Second');

    expect(await scenario.selectRef(ref)).toMatchObject({
      status: 'blocked',
      blockers: [expect.objectContaining({ code: 'STALE_CATALOGUE' })],
    });
  });
});
