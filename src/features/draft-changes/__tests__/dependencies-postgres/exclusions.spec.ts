import { createPersistedDependencyTestKit } from './support/persisted-dependency-scenario';

describe('Draft Changes dependencies: native hard denials', () => {
  let kit: Awaited<ReturnType<typeof createPersistedDependencyTestKit>>;
  beforeAll(async () => {
    kit = await createPersistedDependencyTestKit();
  });
  afterAll(async () => {
    await kit?.close();
  });

  it('blocks a required target row that was explicitly excluded', async () => {
    const scenario = await kit.givenLinkedProduct();
    await scenario.createRequiredTarget();
    await scenario.editReferenceAndNote();
    const result = await scenario.selectLink('commit', [
      { kind: 'rows', tableId: 'products', rowIds: ['required-target'] },
    ]);
    expect(result).toMatchObject({
      status: 'blocked',
      blockers: expect.arrayContaining([
        expect.objectContaining({
          code: 'EXCLUDED_PREREQUISITE',
          role: 'head',
        }),
      ]),
    });
  });

  it('blocks the generated schema retarget when its FK field is denied', async () => {
    const scenario = await kit.givenLinkedProduct();
    await scenario.descriptionThenRename();
    const result = await scenario.selectTableRename('commit', [
      {
        kind: 'schemaFields',
        tableId: 'renamed-products',
        paths: ['/properties/link'],
      },
    ]);
    expect(result).toMatchObject({
      status: 'blocked',
      blockers: expect.arrayContaining([
        expect.objectContaining({
          code: 'EXCLUDED_REFERENCE_REWRITE',
          role: 'head',
          path: '/properties/link',
        }),
      ]),
    });
  });
});
