import {
  createPersistedReferenceDeletionKit,
  deletionRows,
} from './support/persisted-reference-deletion';

describe('Draft Changes dependencies: native deletion repairs', () => {
  let kit: Awaited<ReturnType<typeof createPersistedReferenceDeletionKit>>;

  beforeAll(async () => {
    kit = await createPersistedReferenceDeletionKit();
  });

  afterAll(async () => {
    await kit?.close();
  });

  it('requires the existing source retarget when committing target deletion', async () => {
    const scenario = await kit.givenReferencedTarget();
    await scenario.retargetThenDelete();
    const required = await scenario.requiredRetarget();

    const result = await scenario.commitTargetDeletion();

    expect(result).toMatchObject({
      status: 'resolved',
      required: [required],
      automatic: [],
    });
    expect(deletionRows(result, 'head', 'products')).toEqual([
      { id: 'product', data: { link: 'b', note: 'Head' } },
    ]);
    expect(deletionRows(result, 'draft', 'products')).toEqual([
      { id: 'product', data: { link: 'b', note: 'Draft' } },
    ]);
    expect(deletionRows(result, 'head', 'targets')).toEqual([
      { id: 'b', data: { code: 'B' } },
    ]);
    expect(deletionRows(result, 'draft', 'targets')).toEqual([
      { id: 'b', data: { code: 'B' } },
    ]);
  });

  it('requires the existing target restoration when discarding the source retarget', async () => {
    const scenario = await kit.givenReferencedTarget();
    await scenario.retargetThenDelete();
    const required = await scenario.requiredTargetRestoration();

    const result = await scenario.discardSourceRetarget();

    expect(result).toMatchObject({
      status: 'resolved',
      required: [required],
      automatic: [],
    });
    expect(deletionRows(result, 'head', 'products')).toEqual([
      { id: 'product', data: { link: 'a', note: 'Head' } },
    ]);
    expect(deletionRows(result, 'draft', 'products')).toEqual([
      { id: 'product', data: { link: 'a', note: 'Draft' } },
    ]);
    expect(deletionRows(result, 'head', 'targets')).toEqual([
      { id: 'a', data: { code: 'A' } },
      { id: 'b', data: { code: 'B' } },
    ]);
    expect(deletionRows(result, 'draft', 'targets')).toEqual([
      { id: 'a', data: { code: 'A' } },
      { id: 'b', data: { code: 'B' } },
    ]);
  });

  it('requires an actual dependent deletion rather than inventing a cascade', async () => {
    const scenario = await kit.givenReferencedTarget();
    await scenario.deleteSourceThenTarget();
    const required = await scenario.requiredSourceDeletion();

    const result = await scenario.commitTargetDeletion();

    expect(result).toMatchObject({
      status: 'resolved',
      required: [required],
      automatic: [],
    });
    expect(deletionRows(result, 'head', 'products')).toEqual([]);
    expect(deletionRows(result, 'draft', 'products')).toEqual([]);
    expect(deletionRows(result, 'head', 'targets')).toEqual([
      { id: 'b', data: { code: 'B' } },
    ]);
  });

  it('preserves a surviving reference cycle using the recorded retarget', async () => {
    const scenario = await kit.givenReferenceCycle();
    await scenario.retargetThenDelete();
    const required = await scenario.requiredRetarget();

    const result = await scenario.commitTargetDeletion();

    expect(result).toMatchObject({
      status: 'resolved',
      required: [required],
      automatic: [],
    });
    expect(deletionRows(result, 'head', 'products')).toEqual([
      { id: 'product', data: { link: 'b', note: 'Head' } },
    ]);
    expect(deletionRows(result, 'draft', 'products')).toEqual([
      { id: 'product', data: { link: 'b', note: 'Draft' } },
    ]);
    expect(deletionRows(result, 'head', 'targets')).toEqual([
      { id: 'b', data: { code: 'B', back: 'product' } },
    ]);
    expect(deletionRows(result, 'draft', 'targets')).toEqual([
      { id: 'b', data: { code: 'B', back: 'product' } },
    ]);
  });

  it('blocks two unrelated recorded repairs instead of choosing a destructive one', async () => {
    const scenario = await kit.givenReferencedTarget();
    await scenario.removeLinkThenDeleteSourceAndTarget();
    const before = await scenario.readSnapshot();

    const result = await scenario.commitTargetDeletion();

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: expect.arrayContaining([
        expect.objectContaining({
          code: 'AMBIGUOUS_REFERENCE_REPAIR',
          role: 'head',
          tableCreatedId: scenario.tableCreatedId,
          rowCreatedId: scenario.rowCreatedId,
          path: '/link',
        }),
      ]),
    });
    expect(await scenario.readSnapshot()).toEqual(before);
  });
});
