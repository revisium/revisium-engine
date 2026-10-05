import {
  createPersistedDependencyTestKit,
  linkedRows,
  requiredReferenceValues,
  foreignTableRows,
  originalProductRows,
} from './support/persisted-dependency-scenario';

describe('Draft Changes dependencies: native required rows', () => {
  let kit: Awaited<ReturnType<typeof createPersistedDependencyTestKit>>;
  beforeAll(async () => {
    kit = await createPersistedDependencyTestKit();
  });
  afterAll(async () => {
    await kit?.close();
  });

  it('requires the target row without publishing its sibling or an independent field', async () => {
    const scenario = await kit.givenLinkedProduct();
    await scenario.createRequiredTarget();
    await scenario.createSibling();
    await scenario.editReferenceAndNote();
    const expectedRequirement = await scenario.requiredTargetEffects();
    const result = await scenario.selectLink('commit');
    expect(linkedRows(result, 'head')).toEqual([
      { id: 'product', data: { link: 'required-target', note: 'Head' } },
      { id: 'required-target', data: { link: 'product', note: 'Target' } },
    ]);
    expect(linkedRows(result, 'draft')).toEqual([
      { id: 'product', data: { link: 'required-target', note: 'Draft' } },
      { id: 'required-target', data: { link: 'product', note: 'Target' } },
      { id: 'sibling', data: { link: 'product', note: 'Sibling' } },
    ]);
    expect(result).toMatchObject({
      status: 'resolved',
      migrationLedger: 'deferred',
      required: [expectedRequirement],
      automatic: [],
    });
  });

  it('closes a transitive target cycle without publishing an unrelated sibling', async () => {
    const scenario = await kit.givenLinkedProduct();
    await scenario.createRequiredTarget();
    await scenario.createCycleTarget();
    await scenario.linkRequiredTargetToCycle();
    await scenario.createSibling();
    await scenario.editReferenceAndNote();
    const expectedRefs = await scenario.cycleEffectRefs();

    const result = await scenario.selectLink('commit');

    expect(linkedRows(result, 'head')).toEqual([
      { id: 'cycle-target', data: { link: 'required-target', note: 'Cycle' } },
      { id: 'product', data: { link: 'required-target', note: 'Head' } },
      { id: 'required-target', data: { link: 'cycle-target', note: 'Target' } },
    ]);
    expect(linkedRows(result, 'draft')).toEqual([
      { id: 'cycle-target', data: { link: 'required-target', note: 'Cycle' } },
      { id: 'product', data: { link: 'required-target', note: 'Draft' } },
      { id: 'required-target', data: { link: 'cycle-target', note: 'Target' } },
      { id: 'sibling', data: { link: 'product', note: 'Sibling' } },
    ]);
    expect(requiredReferenceValues(result)).toEqual(expectedRefs);
  });

  it('requires a foreign table and its referenced row without sibling publication', async () => {
    const scenario = await kit.givenLinkedProduct();
    await scenario.createForeignTable();
    const expectedRefs = await scenario.foreignTableEffectRefs();

    const result = await scenario.selectForeignTableSchema();

    expect(originalProductRows(result, 'head')).toEqual([
      { id: 'product', data: { link: 'product', note: 'Head' } },
    ]);
    expect(originalProductRows(result, 'draft')).toEqual([
      { id: 'product', data: { link: 'product', note: 'Draft' } },
    ]);
    expect(foreignTableRows(result, 'head')).toEqual([
      { id: 'product', data: { code: 'Target' } },
    ]);
    expect(foreignTableRows(result, 'draft')).toEqual([
      { id: 'product', data: { code: 'Target' } },
      { id: 'sibling', data: { code: 'Sibling' } },
    ]);
    expect(requiredReferenceValues(result)).toEqual(expectedRefs);
  });

  it.each([
    ['commit', 'renamed-product'],
    ['discard', 'product'],
  ] as const)(
    'rewrites a native self reference during %s while preserving the independent Draft edit',
    async (operation, rowId) => {
      const scenario = await kit.givenLinkedProduct();
      await scenario.renameProductRow();
      await scenario.editRenamedNote();
      const expectedAutomatic = await scenario.automaticRowRename(operation);
      const result = await scenario.selectRowRename(operation);
      expect(result).toMatchObject({
        status: 'resolved',
        required: [],
        automatic: expectedAutomatic,
      });
      expect(linkedRows(result, 'head')).toEqual([
        { id: rowId, data: { link: rowId, note: 'Head' } },
      ]);
      expect(linkedRows(result, 'draft')).toEqual([
        { id: rowId, data: { link: rowId, note: 'Draft' } },
      ]);
    },
  );

  it('does not persist calculated dependency states', async () => {
    const scenario = await kit.givenLinkedProduct();
    await scenario.descriptionThenRename();
    const before = await scenario.readSnapshot();
    const result = await scenario.selectTableRename('commit');
    expect(result.status).toBe('resolved');
    expect(await scenario.readSnapshot()).toEqual(before);
  });
});
