import { createPersistedSchemaTestKit } from './support/persisted-schema-scenario';

describe('Draft Changes schema projection: persisted history', () => {
  let kit: Awaited<ReturnType<typeof createPersistedSchemaTestKit>>;

  beforeAll(async () => {
    kit = await createPersistedSchemaTestKit();
  });

  afterAll(async () => {
    await kit?.close();
  });

  it('commits a recorded rename without publishing independent Draft values', async () => {
    const scenario = await kit.givenEditedRename();

    const result = await scenario.project('commit');

    expect(result.head.rows.map(({ data }) => data)).toEqual([
      { cost: 10, title: 'Head' },
    ]);
    expect(result.draft.rows.map(({ data }) => data)).toEqual([
      { cost: 15, title: 'Draft' },
    ]);
  });

  it('preserves independent Draft values when discarding a recorded rename', async () => {
    const scenario = await kit.givenEditedRename();

    const result = await scenario.project('discard');

    expect(result.draft.rows.map(({ data }) => data)).toEqual([
      { price: 15, title: 'Draft' },
    ]);
  });

  it('projects schema history after a public table rename', async () => {
    const scenario = await kit.givenEditedRename();
    await scenario.renameTable('renamed-products');

    const result = await scenario.project('discard');

    expect(result.draft.rows.map(({ data }) => data)).toEqual([
      { price: 15, title: 'Draft' },
    ]);
  });

  it('projects valid history whose initial required fields have a different order', async () => {
    const scenario = await kit.givenRenameWithUnorderedRequired();

    const result = await scenario.project('commit');

    expect(result.head.rows.map(({ data }) => data)).toEqual([
      { cost: 10, title: 'Head' },
    ]);
  });

  it('leaves the persisted branch unchanged during schema projection', async () => {
    const scenario = await kit.givenEditedRename();
    const before = await scenario.readSnapshot();

    await scenario.project('discard');

    expect(await scenario.readSnapshot()).toEqual(before);
  });

  it('blocks dependent values without transferring them to another added field', async () => {
    const scenario = await kit.givenEditedSiblingAdds();

    const result = await scenario.discardFirstAddedField();

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [
        expect.objectContaining({
          code: 'UNREPRESENTABLE_REMAINDER',
          path: '/x',
        }),
      ],
    });
  });

  it('maps the selected recorded add to its own field identity', async () => {
    const scenario = await kit.givenEditedSiblingAdds();

    const result = await scenario.commitSecondAddedField();

    expect(result.rowTargetFieldMappings).toContainEqual({
      fromPath: '/y',
      toPath: '/y',
    });
    expect(result.rowTargetFieldMappings).not.toContainEqual({
      fromPath: '/x',
      toPath: '/y',
    });
  });

  it('reports dependent values in current Draft coordinates after separate schema updates', async () => {
    const scenario = await kit.givenEditedRename();
    await scenario.replaceRenamedPriceWithString();

    const result = await scenario.discardRecordedRenameAndReplacement();

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [
        expect.objectContaining({
          code: 'UNREPRESENTABLE_REMAINDER',
          path: '/cost',
        }),
      ],
    });
  });

  it('accepts returned data fields to discard incompatible renamed values', async () => {
    const scenario = await kit.givenEditedRename();
    await scenario.replaceRenamedPriceWithString();
    const blocked = await scenario.discardRecordedRenameAndReplacement();

    const result = await scenario.discardRequiredDataFields(blocked);

    expect(result.draft.rows.map(({ data }) => data)).toEqual([
      { price: 10, title: 'Draft' },
    ]);
  });
});
