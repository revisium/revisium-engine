import {
  buildCatalogue,
  catalogueResult,
  givenCatalogueScenario,
  givenTwoTableCatalogueScenario,
  duplicateHeadRowIdentity,
  requireMutableRowFieldTarget,
  requireRowFieldEntry,
  requiredScenarioProjection,
  requiredTwoScenarioProjections,
  reverseSnapshotTableOrder,
} from './support/catalogue-scenario';

describe('draft changes catalogue references', () => {
  it('retains known unchanged table and row identities for later ID selection', async () => {
    const scenario = await givenCatalogueScenario();

    const catalogue = await buildCatalogue(scenario);

    expect(catalogue.identityBindings).toContainEqual({
      kind: 'row',
      tableCreatedId: scenario.tableCreatedId,
      entityCreatedId: 'row-product',
      headIds: ['row-product'],
      draftIds: ['row-product'],
    });
  });

  it('emits the same exact refs when table and row input order changes', async () => {
    const rows = [
      { createdId: 'row-a', data: { title: 'A', price: 1 } },
      { createdId: 'row-b', data: { title: 'B', price: 2 } },
    ];
    const editedRows = [
      { createdId: 'row-a', data: { title: 'A edited', price: 1 } },
      { createdId: 'row-b', data: { title: 'B edited', price: 2 } },
    ];
    const forward = await givenCatalogueScenario({
      headRows: rows,
      draftRows: editedRows,
    });
    const reversed = await reverseSnapshotTableOrder(forward);

    const firstRefs = (await buildCatalogue(forward)).entries
      .map(({ ref }) => ref.value)
      .sort();
    const reorderedRefs = (await buildCatalogue(reversed)).entries
      .map(({ ref }) => ref.value)
      .sort();

    expect(firstRefs.length).toBeGreaterThan(0);
    expect(reorderedRefs).toEqual(firstRefs);
  });

  it('blocks a schema projection produced from a different source snapshot', async () => {
    const scenario = await givenCatalogueScenario();
    const supplied = requiredScenarioProjection(scenario);
    const staleProjection = {
      ...supplied.projection,
      sourceFingerprint: 'different-source-fingerprint',
    };
    const result = await catalogueResult({
      snapshot: scenario.snapshot,
      schemaProjections: [
        {
          tableCreatedId: supplied.tableCreatedId,
          projection: staleProjection,
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'SCHEMA_PROJECTION_SNAPSHOT_MISMATCH' }],
    });
  });

  it('blocks a shared table when its required full schema projection is absent', async () => {
    const scenario = await givenCatalogueScenario();
    const result = await catalogueResult({
      snapshot: scenario.snapshot,
      schemaProjections: [],
    });

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'SCHEMA_PROJECTION_MISMATCH' }],
    });
  });

  it('blocks a projection attested for a different stable table in the same snapshot', async () => {
    const scenario = await givenCatalogueScenario();
    const supplied = requiredScenarioProjection(scenario);
    const mislabeled = {
      ...supplied.projection,
      tableCreatedId: 'another-table',
    };
    const result = await catalogueResult({
      snapshot: scenario.snapshot,
      schemaProjections: [
        { tableCreatedId: supplied.tableCreatedId, projection: mislabeled },
      ],
    });

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'SCHEMA_PROJECTION_TABLE_MISMATCH' }],
    });
  });

  it('rejects a projection that is relabeled from another table in the same snapshot', async () => {
    const scenario = await givenTwoTableCatalogueScenario();
    const [first, second] = requiredTwoScenarioProjections(scenario);
    const result = await catalogueResult({
      snapshot: scenario.snapshot,
      schemaProjections: [
        first,
        {
          ...second,
          projection: {
            ...second.projection,
            tableCreatedId: first.tableCreatedId,
          },
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'SCHEMA_PROJECTION_TABLE_MISMATCH' }],
    });
  });

  it('rejects duplicate stable row identities in a supplied snapshot', async () => {
    const scenario = await givenCatalogueScenario();
    const snapshot = structuredClone(scenario.snapshot);
    duplicateHeadRowIdentity(scenario, snapshot);

    const result = await catalogueResult({
      snapshot,
      schemaProjections: scenario.schemaProjections,
    });

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'AMBIGUOUS_IDENTITY' }],
    });
  });

  it('detaches returned catalogue entries from the supplied snapshot and projection', async () => {
    const scenario = await givenCatalogueScenario({
      headRows: [
        { createdId: 'row-product', data: { title: 'Head', extra: 1 } },
      ],
      draftRows: [
        { createdId: 'row-product', data: { title: 'Draft', extra: 1 } },
      ],
    });
    const before = structuredClone(scenario);
    const catalogue = await buildCatalogue(scenario);
    const field = requireRowFieldEntry(catalogue);
    requireMutableRowFieldTarget(field).path = '/changed';

    expect(scenario).toEqual(before);
  });

  it('does not mutate the supplied snapshot, projection, or reference payloads', async () => {
    const scenario = await givenCatalogueScenario();
    const before = structuredClone(scenario);

    await buildCatalogue(scenario);

    expect(scenario).toEqual(before);
  });

  it('returns a blocker instead of partial entries when schema projection is blocked', async () => {
    const scenario = await givenCatalogueScenario();
    const supplied = requiredScenarioProjection(scenario);

    const result = await catalogueResult({
      snapshot: scenario.snapshot,
      schemaProjections: [
        {
          tableCreatedId: supplied.tableCreatedId,
          projection: {
            status: 'blocked',
            blockers: [
              { code: 'SCHEMA_HISTORY_INVALID', message: 'invalid history' },
            ],
          },
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'SCHEMA_PROJECTION_BLOCKED' }],
    });
  });
});
