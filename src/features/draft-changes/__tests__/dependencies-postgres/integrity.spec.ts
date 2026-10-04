import { createPersistedDependencyTestKit } from './support/persisted-dependency-scenario';

describe('Draft Changes dependencies: native reference integrity', () => {
  let kit: Awaited<ReturnType<typeof createPersistedDependencyTestKit>>;
  beforeAll(async () => {
    kit = await createPersistedDependencyTestKit();
  });
  afterAll(async () => {
    await kit?.close();
  });

  it('validates an empty-string FK row ID instead of skipping it', async () => {
    const scenario = await kit.givenLinkedProduct('');
    const result = await scenario.resolve('commit', { include: [] });
    expect(result).toMatchObject({
      status: 'blocked',
      blockers: expect.arrayContaining([
        expect.objectContaining({
          code: 'MISSING_REFERENCE_TARGET',
          role: 'head',
          path: '/link',
          targetRowId: '',
        }),
      ]),
    });
  });
});
