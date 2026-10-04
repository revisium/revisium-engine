import {
  candidateSchemaHash,
  createPersistedCandidateTestKit,
  sourceSchemaHash,
} from './support/persisted-candidate-scenario';
import {
  createdRowSchemaHashes,
  createdTableRowSchemaHashes,
} from './support/candidate-results';

describe('Draft Changes candidates: persisted schema metadata', () => {
  let kit: Awaited<ReturnType<typeof createPersistedCandidateTestKit>>;

  beforeAll(async () => {
    kit = await createPersistedCandidateTestKit();
  });

  afterAll(async () => {
    await kit?.close();
  });

  it('preserves the meta-schema hash when publishing a user schema', async () => {
    const scenario = await kit.givenProduct();
    const original = await scenario.readSnapshot();
    await scenario.addDefaultField();

    const result = await scenario.calculateSchema('commit', [
      '/properties/extra',
    ]);

    expect(candidateSchemaHash(result, 'head')).toBe(
      sourceSchemaHash(original),
    );
  });

  it('uses the new table schema when another public ID equals its stable ID', async () => {
    const scenario = await kit.givenCreatedTableIdentityCollision();

    const result = await scenario.calculate();

    const hashes = createdTableRowSchemaHashes(result);
    expect(hashes.actual).toBe(hashes.expected);
  });

  it('publishes a created row with the resulting Head schema hash', async () => {
    const scenario = await kit.givenProduct();
    await scenario.editPriceDescription();
    await scenario.createPlainRow();

    const result = await scenario.calculate('commit', {
      include: [{ kind: 'rows', tableId: 'products', rowIds: ['new'] }],
    });

    const hashes = createdRowSchemaHashes(result);
    expect(hashes.head.actual).toBe(hashes.head.expected);
    expect(hashes.draft.actual).toBe(hashes.draft.expected);
  });
});
