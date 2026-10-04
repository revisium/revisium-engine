import { createPersistedCandidateTestKit } from './support/persisted-candidate-scenario';
import {
  candidateProductData,
  candidateSchemas,
  candidateTableNames,
  originalSchemas,
} from './support/table-identities';

describe('Draft Changes candidates: persisted table identities', () => {
  let kit: Awaited<ReturnType<typeof createPersistedCandidateTestKit>>;

  beforeAll(async () => {
    kit = await createPersistedCandidateTestKit();
  });

  afterAll(async () => {
    await kit?.close();
  });

  it.each([
    [
      'commit',
      'head',
      'secondary-products',
      'products',
      { price: 10, title: 'Head' },
    ],
    [
      'discard',
      'draft',
      'products',
      'secondary-products',
      { price: 25, title: 'Draft', extra: 7 },
    ],
  ] as const)(
    'preserves stable schema identities and pending schema during %s of native name swap',
    async (operation, role, primaryName, secondaryName, expectedData) => {
      const scenario = await kit.givenTableSwap();

      const result = await scenario.calculate(operation);

      expect(candidateTableNames(result, role, scenario.original)).toEqual({
        products: primaryName,
        'secondary-products': secondaryName,
      });
      expect(candidateSchemas(result, role, scenario.original)).toEqual(
        originalSchemas(scenario.original, role),
      );
      expect(candidateProductData(result, role, scenario.original)).toEqual(
        expectedData,
      );
    },
  );
});
