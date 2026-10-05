import { createPersistedReferenceBoundaryKit } from './support/persisted-reference-boundaries';

describe('Draft Changes native reference boundaries', () => {
  let kit: Awaited<ReturnType<typeof createPersistedReferenceBoundaryKit>>;

  beforeAll(async () => {
    kit = await createPersistedReferenceBoundaryKit();
  });

  afterAll(async () => {
    await kit?.close();
  });

  it('preserves an unselected target rename when committing only note', async () => {
    const scenario = await kit.givenUnselectedRowRename();

    const result = await scenario.commitOnlyNote();

    expect(scenario.rows(result)).toEqual({
      head: { id: 'product', data: { link: 'product', note: 'Draft' } },
      draft: {
        id: 'renamed-product',
        data: { link: 'renamed-product', note: 'Draft' },
      },
    });
    expect(result).toMatchObject({ required: [], automatic: [] });
  });

  it('rewrites only the array occurrence bound to the renamed target', async () => {
    const scenario = await kit.givenDistinctArrayTargets();

    const result = await scenario.commitTargetRename();

    const expected = {
      id: 'product',
      data: { links: [{ fk: 'b' }, { fk: 'x' }] },
    };
    expect(scenario.rows(result)).toEqual({ head: expected, draft: expected });
    expect(result).toMatchObject({
      required: [],
      automatic: [scenario.automatic],
    });
  });
});
