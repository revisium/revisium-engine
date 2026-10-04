import {
  createPersistedDependencyTestKit,
  linkedSchemas,
  schemaHistoryChecks,
  headSchemaUnchanged,
} from './support/persisted-dependency-scenario';

describe('Draft Changes dependencies: native table rename', () => {
  let kit: Awaited<ReturnType<typeof createPersistedDependencyTestKit>>;
  beforeAll(async () => {
    kit = await createPersistedDependencyTestKit();
  });
  afterAll(async () => {
    await kit?.close();
  });

  it.each([
    [
      'commit',
      'descriptionThenRename',
      'renamed-products',
      'renamed-products',
      false,
    ],
    [
      'commit',
      'renameThenDescription',
      'renamed-products',
      'renamed-products',
      false,
    ],
    ['discard', 'descriptionThenRename', 'products', 'products', true],
    ['discard', 'renameThenDescription', 'products', 'products', true],
  ] as const)(
    'preserves independent description during %s after %s',
    async (operation, setup, headTable, draftTable, unchangedHead) => {
      const scenario = await kit.givenLinkedProduct();
      await scenario[setup]();
      const expectedAutomatic = await scenario.automaticSchemaRename(operation);
      const result = await scenario.selectTableRename(operation);
      expect(linkedSchemas(result)).toEqual({
        head: { table: headTable, description: 'Head' },
        draft: { table: draftTable, description: 'Draft' },
      });
      expect(result).toMatchObject({
        status: 'resolved',
        required: [],
        automatic: expectedAutomatic,
      });
      expect(headSchemaUnchanged(result, scenario.originalHead)).toBe(
        unchangedHead,
      );
      expect(schemaHistoryChecks(result)).toEqual({
        headReplay: true,
        draftReplay: true,
        prefix: true,
        headHash: true,
        draftHash: true,
      });
    },
  );
});
