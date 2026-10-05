import {
  createPersistedCandidateTestKit,
  productStates,
  restoredProductHash,
  restoredProductMetadata,
  restoredSchemaHistory,
} from './support/persisted-candidate-scenario';

describe('Draft Changes candidates: persisted restoration', () => {
  let kit: Awaited<ReturnType<typeof createPersistedCandidateTestKit>>;

  beforeAll(async () => {
    kit = await createPersistedCandidateTestKit();
  });

  afterAll(async () => {
    await kit?.close();
  });

  it('restores hash-only drift without a semantic change', async () => {
    const scenario = await kit.givenProduct();
    await scenario.tamperProductHash();
    const headHash = await scenario.headProductHash();

    const result = await scenario.restoreHead();

    expect(result).toMatchObject({
      status: 'calculated',
      migrationLedger: 'deferred',
    });
    expect(restoredProductHash(result)).toBe(headHash);
    expect(productStates(result)).toEqual({
      head: { price: 10, title: 'Head' },
      draft: { price: 10, title: 'Head' },
    });
  });

  it('restores Head despite malformed Draft schema history', async () => {
    const scenario = await kit.givenProduct();
    await scenario.damageSchemaHistory();
    const headHistory = await scenario.headSchemaHistory();

    const result = await scenario.restoreHead();

    expect(restoredSchemaHistory(result)).toEqual(headHistory);
    expect(productStates(result)).toEqual({
      head: { price: 10, title: 'Head' },
      draft: { price: 10, title: 'Head' },
    });
  });

  it('restores an invalid field while retaining a valid independent edit', async () => {
    const scenario = await kit.givenProduct();
    await scenario.invalidatePriceKeepingTitle();

    const result = await scenario.calculateFields('discard', ['/price']);

    expect(productStates(result)).toEqual({
      head: { price: 10, title: 'Head' },
      draft: { price: 10, title: 'Draft' },
    });
  });

  it('restores a deleted row under the remaining Draft schema', async () => {
    const scenario = await kit.givenProduct();
    await scenario.deleteProduct();
    await scenario.addDefaultField();

    const result = await scenario.calculate('discard', {
      include: [{ kind: 'rows', tableId: 'products', rowIds: ['product'] }],
    });

    expect(productStates(result)).toEqual({
      head: { price: 10, title: 'Head' },
      draft: { price: 10, title: 'Head', extra: 0 },
    });
  });

  it('refreshes restored row metadata for the remaining Draft schema', async () => {
    const scenario = await kit.givenProduct();
    await scenario.deleteProduct();
    await scenario.addDefaultField();

    const result = await scenario.calculate('discard', {
      include: [{ kind: 'rows', tableId: 'products', rowIds: ['product'] }],
    });

    const metadata = restoredProductMetadata(result);
    expect(metadata.hash).toBe(metadata.expectedHash);
    expect(metadata.schemaHash).toBe(metadata.expectedSchemaHash);
    expect(metadata.readonly).toBe(false);
  });

  it('blocks commit when an unselected Draft field stays invalid', async () => {
    const scenario = await kit.givenProduct();
    await scenario.invalidatePriceKeepingTitle();

    const result = await scenario.calculateFields('commit', ['/title']);

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [
        expect.objectContaining({ code: 'INVALID_RESULT_DATA', role: 'draft' }),
      ],
    });
  });
});
