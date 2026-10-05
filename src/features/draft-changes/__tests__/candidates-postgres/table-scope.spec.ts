import {
  createPersistedCandidateTestKit,
  candidateTableRows,
} from './support/persisted-candidate-scenario';

describe('Draft Changes candidates: persisted table row scope', () => {
  let kit: Awaited<ReturnType<typeof createPersistedCandidateTestKit>>;

  beforeAll(async () => {
    kit = await createPersistedCandidateTestKit();
  });

  afterAll(async () => {
    await kit?.close();
  });

  it('requires row deletion before deleting a table with rows:none', async () => {
    const scenario = await kit.givenProduct();
    await scenario.deleteTable();
    const required = await scenario.deletedRowReference();

    const result = await scenario.calculate('commit', {
      include: [{ kind: 'table', tableId: 'products', rows: 'none' }],
    });

    expect(result).toMatchObject({
      status: 'needsEffects',
      requirements: [
        expect.objectContaining({ kind: 'catalogueEffects', refs: [required] }),
      ],
    });
  });

  it('restores an empty table when row restoration was not selected', async () => {
    const scenario = await kit.givenProduct();
    await scenario.deleteTable();

    const result = await scenario.calculate('discard', {
      include: [{ kind: 'table', tableId: 'products', rows: 'none' }],
    });

    expect(candidateTableRows(result, 'draft', 'products')).toEqual([]);
  });

  it('requires table restoration before restoring a deleted row', async () => {
    const scenario = await kit.givenProduct();
    await scenario.deleteTable();
    const required = await scenario.deletedTableReference();

    const result = await scenario.calculate('discard', {
      include: [{ kind: 'rows', tableId: 'products', rowIds: ['product'] }],
    });

    expect(result).toMatchObject({
      status: 'needsEffects',
      requirements: [
        expect.objectContaining({ kind: 'catalogueEffects', refs: [required] }),
      ],
    });
  });
});
