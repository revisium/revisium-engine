import {
  givenRestoreHeadCandidate,
  givenSelectedCandidate,
  requireRowFieldEntry,
  requireSchemaEntry,
  rowFields,
  schemaFields,
  schemaWith,
} from 'src/features/draft-changes/__tests__/candidates/support/candidate-scenario';
import { CANDIDATE_ROW_ID } from 'src/features/draft-changes/__tests__/candidates/support/candidate-scenarios';
import { CATALOGUE_TABLE_CREATED_ID } from 'src/features/draft-changes/__tests__/catalogue/support/catalogue-scenario';
import {
  addField,
  numberField,
  rowInput,
  stringField,
  givenSchemaPatchGroups,
} from 'src/features/draft-changes/__tests__/schema/support/schema-projection-fixture';
import {
  givenLinkedTargetCandidate,
  rowCreatedIds,
  resolveDependencies,
  rowIds,
  schemaForTable,
} from './support/dependency-scenario';
import {
  requireCandidateBlocker,
  requireResolvedDependencies,
} from './support/dependency-results';

describe('draft changes candidate dependency closure', () => {
  it('resolves a valid candidate with no foreign-key references unchanged', async () => {
    const data = await givenRestoreHeadCandidate();
    const original = structuredClone(data.snapshot);

    const result = await resolveDependencies(data);

    const resolved = requireResolvedDependencies(result);
    expect(resolved.head).toEqual(data.snapshot.head);
    expect(resolved.draft).toEqual(data.snapshot.head);
    expect(resolved.head).not.toBe(data.snapshot.head);
    expect(data.snapshot).toEqual(original);
    expect(resolved.required).toEqual([]);
    expect(resolved.automatic).toEqual([]);
    expect(resolved.migrationLedger).toBe('deferred');
  });

  it('includes only a referenced new target row and keeps Draft siblings', async () => {
    const scenario = await givenLinkedTargetCandidate({
      targetRows: [
        { createdId: 'required-target', data: { code: 'Target' } },
        { createdId: 'sibling-target', data: { code: 'Sibling' } },
      ],
    });

    const result = await resolveDependencies(scenario.data);

    const resolved = requireResolvedDependencies(result);
    expect(resolved.required).toContainEqual({
      role: 'head',
      kind: 'catalogueEffects',
      causeRef: scenario.sourceChange.ref,
      refs: [scenario.requiredTargetRef],
    });
    expect(rowIds(resolved.head, 'stable-secondary-products')).toEqual([
      'required-target',
    ]);
    expect(rowIds(resolved.draft, 'stable-secondary-products')).toEqual([
      'required-target',
      'sibling-target',
    ]);
  });

  it('binds a selected new source row to the target identity present in Draft', async () => {
    const scenario = await givenLinkedTargetCandidate({
      sourceCreatedRow: true,
      targetRows: [
        { createdId: 'required-target', data: { code: 'Target' } },
        { createdId: 'sibling-target', data: { code: 'Sibling' } },
      ],
    });

    const result = await resolveDependencies(scenario.data);

    const resolved = requireResolvedDependencies(result);
    expect(resolved.required).toContainEqual({
      role: 'head',
      kind: 'catalogueEffects',
      causeRef: scenario.sourceChange.ref,
      refs: [scenario.requiredTargetRef],
    });
    expect(rowIds(resolved.head, 'stable-products')).toContain(
      'source-created',
    );
    expect(rowIds(resolved.head, 'stable-secondary-products')).toEqual([
      'required-target',
    ]);
    expect(rowIds(resolved.draft, 'stable-secondary-products')).toEqual([
      'required-target',
      'sibling-target',
    ]);
  });

  it('requires deletion and creation when the selected Draft target reuses a public ID', async () => {
    const scenario = await givenLinkedTargetCandidate({
      sourceCreatedRow: true,
      sourceReference: 'reused-target-id',
      headTargetRows: [
        { createdId: 'old-target', data: { code: 'Old target' } },
      ],
      targetRows: [
        { createdId: 'required-target', data: { code: 'New target' } },
      ],
      reusedTarget: {
        headRowCreatedId: 'old-target',
        draftRowCreatedId: 'required-target',
        publicId: 'reused-target-id',
      },
    });

    const result = await resolveDependencies(scenario.data);

    const resolved = requireResolvedDependencies(result);
    expect(resolved.required).toContainEqual(
      expect.objectContaining({
        role: 'head',
        kind: 'catalogueEffects',
        causeRef: scenario.sourceChange.ref,
        refs: expect.arrayContaining(scenario.targetLifecycleRefs),
      }),
    );
    expect(rowIds(resolved.head, 'stable-secondary-products')).toEqual([
      'reused-target-id',
    ]);
    expect(rowIds(resolved.draft, 'stable-secondary-products')).toEqual([
      'reused-target-id',
    ]);
    expect(rowCreatedIds(resolved.head, 'stable-secondary-products')).toEqual([
      'required-target',
    ]);
    expect(rowCreatedIds(resolved.draft, 'stable-secondary-products')).toEqual([
      'required-target',
    ]);
  });

  it('requires the exact schema history before selecting a new field value', async () => {
    const headSchema = schemaWith({ title: stringField() });
    const added = givenSchemaPatchGroups(headSchema, [
      [addField('/properties/extra', numberField())],
      [
        {
          op: 'replace',
          path: '/properties/extra',
          value: { ...numberField(), description: 'Draft extra description' },
        },
      ],
    ]);
    const { data, catalogue } = await givenSelectedCandidate({
      operation: 'commit',
      selection: rowFields('products', CANDIDATE_ROW_ID, ['/extra']),
      scenario: {
        headSchema,
        draftSchema: added.terminalSchema,
        pending: added.steps,
        headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head' })],
        draftRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Draft', extra: 7 })],
      },
    });
    const schemaEntry = requireSchemaEntry(catalogue, '/properties/extra');
    const rowEntry = requireRowFieldEntry(catalogue, '/extra');

    const result = await resolveDependencies(data);

    const resolved = requireResolvedDependencies(result);
    expect(added.steps).toHaveLength(2);
    expect(schemaEntry.effectRefs).toEqual([
      { historyIndex: 1, patchIndex: 0 },
      { historyIndex: 2, patchIndex: 0 },
    ]);
    expect(resolved.required).toEqual([
      {
        kind: 'schemaEffects',
        role: 'head',
        causeRef: rowEntry.ref,
        tableCreatedId: CATALOGUE_TABLE_CREATED_ID,
        effects: [{ historyIndex: 1, patchIndex: 0 }],
      },
    ]);
    expect(schemaForTable(resolved.head, 'products')).not.toHaveProperty(
      'properties.extra.description',
    );
    expect(schemaForTable(resolved.draft, 'products')).toHaveProperty(
      'properties.extra.description',
      'Draft extra description',
    );
  });

  it('blocks a denied schema history required by a selected new field value', async () => {
    const headSchema = schemaWith({ title: stringField() });
    const added = givenSchemaPatchGroups(headSchema, [
      [addField('/properties/extra', numberField())],
    ]);
    const { data } = await givenSelectedCandidate({
      operation: 'commit',
      selection: rowFields('products', CANDIDATE_ROW_ID, ['/extra']),
      scenario: {
        headSchema,
        draftSchema: added.terminalSchema,
        pending: added.steps,
        headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head' })],
        draftRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Draft', extra: 7 })],
      },
      deniedSchemaChangePath: '/properties/extra',
    });

    const result = await resolveDependencies(data);

    expect(
      requireCandidateBlocker(result, 'EXCLUDED_PREREQUISITE'),
    ).toMatchObject({
      role: 'head',
      tableCreatedId: CATALOGUE_TABLE_CREATED_ID,
    });
  });

  it('requires the exact existing Draft field before discarding its schema', async () => {
    const headSchema = schemaWith({ title: stringField() });
    const added = givenSchemaPatchGroups(headSchema, [
      [addField('/properties/extra', numberField())],
    ]);
    const { data, catalogue } = await givenSelectedCandidate({
      operation: 'discard',
      selection: schemaFields('products', ['/properties/extra']),
      scenario: {
        headSchema,
        draftSchema: added.terminalSchema,
        pending: added.steps,
        headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head' })],
        draftRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Draft', extra: 7 })],
      },
    });
    const schemaEntry = requireSchemaEntry(catalogue, '/properties/extra');
    const rowEntry = requireRowFieldEntry(catalogue, '/extra');

    const result = await resolveDependencies(data);

    const resolved = requireResolvedDependencies(result);
    expect(resolved.required).toContainEqual({
      kind: 'catalogueEffects',
      role: 'draft',
      causeRef: schemaEntry.ref,
      refs: [rowEntry.ref],
    });
  });

  it('blocks when the Draft data prerequisite for schema discard is denied', async () => {
    const headSchema = schemaWith({ title: stringField() });
    const added = givenSchemaPatchGroups(headSchema, [
      [addField('/properties/extra', numberField())],
    ]);
    const { data } = await givenSelectedCandidate({
      operation: 'discard',
      selection: {
        include: schemaFields('products', ['/properties/extra']).include,
        exclude: rowFields('products', CANDIDATE_ROW_ID, ['/extra']).include,
      },
      scenario: {
        headSchema,
        draftSchema: added.terminalSchema,
        pending: added.steps,
        headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head' })],
        draftRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Draft', extra: 7 })],
      },
    });

    const result = await resolveDependencies(data);

    expect(
      requireCandidateBlocker(result, 'EXCLUDED_PREREQUISITE'),
    ).toMatchObject({
      role: 'draft',
      tableCreatedId: CATALOGUE_TABLE_CREATED_ID,
    });
  });
});
