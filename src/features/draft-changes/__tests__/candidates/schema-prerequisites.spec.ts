import {
  calculateCandidate,
  CANDIDATE_ROW_ID,
  givenSelectedCandidate,
  requireCandidateRequirements,
  requireRowFieldEntry,
  requireSchemaEntry,
  rowFields,
  schemaWith,
} from './support/candidate-scenario';
import { CATALOGUE_TABLE_CREATED_ID } from 'src/features/draft-changes/__tests__/catalogue/support/catalogue-scenario';
import {
  addField,
  numberField,
  objectSchema,
  rowInput,
  stringField,
  givenSchemaPatchGroups,
} from 'src/features/draft-changes/__tests__/schema/support/schema-projection-fixture';

describe('draft changes candidate schema prerequisites', () => {
  it('requires the exact schema effect before committing a new-field value', async () => {
    const headSchema = schemaWith({ title: stringField() });
    const addedField = givenSchemaPatchGroups(headSchema, [
      [addField('/properties/extra', numberField())],
    ]);
    const { data, catalogue } = await givenSelectedCandidate({
      operation: 'commit',
      selection: rowFields('products', CANDIDATE_ROW_ID, ['/extra']),
      scenario: {
        headSchema,
        draftSchema: addedField.terminalSchema,
        pending: addedField.steps,
        headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head' })],
        draftRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Draft', extra: 7 })],
      },
    });
    const schemaEntry = requireSchemaEntry(catalogue, '/properties/extra');
    const rowEntry = requireRowFieldEntry(catalogue, '/extra');

    const result = await calculateCandidate(data);

    expect(result.status).toBe('needsEffects');
    const requirements = requireCandidateRequirements(result);
    expect(requirements.requirements).toContainEqual(
      expect.objectContaining({
        kind: 'schemaEffects',
        role: 'head',
        causeRef: rowEntry.ref,
        tableCreatedId: CATALOGUE_TABLE_CREATED_ID,
        effects: schemaEntry.effectRefs,
      }),
    );
  });

  it('blocks when the exact schema change required by a new value is denied', async () => {
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

    const result = await calculateCandidate(data);

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [expect.objectContaining({ code: 'EXCLUDED_PREREQUISITE' })],
    });
  });

  it('requires the ancestor object creation before committing its child value', async () => {
    const headSchema = schemaWith({ title: stringField() });
    const added = givenSchemaPatchGroups(headSchema, [
      [addField('/properties/new', objectSchema({ x: stringField() }))],
    ]);
    const { data, catalogue } = await givenSelectedCandidate({
      operation: 'commit',
      selection: rowFields('products', CANDIDATE_ROW_ID, ['/new/x']),
      scenario: {
        headSchema,
        draftSchema: added.terminalSchema,
        pending: added.steps,
        headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head' })],
        draftRows: [
          rowInput(CANDIDATE_ROW_ID, { title: 'Draft', new: { x: 'value' } }),
        ],
      },
    });
    const ancestor = requireSchemaEntry(catalogue, '/properties/new');

    const result = await calculateCandidate(data);

    expect(result).toMatchObject({ status: 'needsEffects' });
    expect(requireCandidateRequirements(result).requirements).toContainEqual(
      expect.objectContaining({
        kind: 'schemaEffects',
        effects: ancestor.effectRefs,
      }),
    );
  });

  it('maps an actual properties field without flattening schema grammar segments', async () => {
    const headSchema = schemaWith({ title: stringField() });
    const added = givenSchemaPatchGroups(headSchema, [
      [addField('/properties/properties', objectSchema({ x: stringField() }))],
    ]);
    const { data } = await givenSelectedCandidate({
      operation: 'commit',
      selection: rowFields('products', CANDIDATE_ROW_ID, ['/properties/x']),
      scenario: {
        headSchema,
        draftSchema: added.terminalSchema,
        pending: added.steps,
        headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head' })],
        draftRows: [
          rowInput(CANDIDATE_ROW_ID, {
            title: 'Draft',
            properties: { x: 'value' },
          }),
        ],
      },
    });

    const result = await calculateCandidate(data);

    expect(result).toMatchObject({
      status: 'needsEffects',
      requirements: [
        expect.objectContaining({
          kind: 'schemaEffects',
          effects: [{ historyIndex: 1, patchIndex: 0 }],
        }),
      ],
    });
  });

  it('blocks a child value when its ancestor schema effect is denied', async () => {
    const headSchema = schemaWith({ title: stringField() });
    const added = givenSchemaPatchGroups(headSchema, [
      [addField('/properties/new', objectSchema({ x: stringField() }))],
    ]);
    const { data } = await givenSelectedCandidate({
      operation: 'commit',
      selection: {
        include: rowFields('products', CANDIDATE_ROW_ID, ['/new/x']).include,
        exclude: [
          {
            kind: 'schemaFields',
            tableId: 'products',
            paths: ['/properties/new'],
          },
        ],
      },
      scenario: {
        headSchema,
        draftSchema: added.terminalSchema,
        pending: added.steps,
        headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head' })],
        draftRows: [
          rowInput(CANDIDATE_ROW_ID, { title: 'Draft', new: { x: 'value' } }),
        ],
      },
    });

    const result = await calculateCandidate(data);

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [expect.objectContaining({ code: 'EXCLUDED_PREREQUISITE' })],
    });
  });

  it('requires only the field-creation history effect before its data value', async () => {
    const headSchema = schemaWith({ title: stringField() });
    const added = givenSchemaPatchGroups(headSchema, [
      [addField('/properties/extra', numberField())],
      [
        {
          op: 'replace',
          path: '/properties/extra',
          value: { ...numberField(), description: 'Extra' },
        },
      ],
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
    });

    const result = await calculateCandidate(data);

    expect(result.status).toBe('needsEffects');
    expect(requireCandidateRequirements(result).requirements).toContainEqual(
      expect.objectContaining({
        kind: 'schemaEffects',
        effects: [{ historyIndex: 1, patchIndex: 0 }],
      }),
    );
  });

  it('requires the schema effect for an atomic array with a new item field', async () => {
    const headSchema = schemaWith({
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['price'],
          properties: { price: numberField() },
        },
      },
    });
    const added = givenSchemaPatchGroups(headSchema, [
      [addField('/properties/items/items/properties/extra', numberField())],
    ]);
    const { data } = await givenSelectedCandidate({
      operation: 'commit',
      selection: rowFields('products', CANDIDATE_ROW_ID, ['/items']),
      scenario: {
        headSchema,
        draftSchema: added.terminalSchema,
        pending: added.steps,
        headRows: [rowInput(CANDIDATE_ROW_ID, { items: [{ price: 1 }] })],
        draftRows: [
          rowInput(CANDIDATE_ROW_ID, { items: [{ price: 2, extra: 3 }] }),
        ],
      },
    });

    const result = await calculateCandidate(data);

    expect(result).toMatchObject({
      status: 'needsEffects',
      requirements: [
        expect.objectContaining({
          kind: 'schemaEffects',
          effects: [{ historyIndex: 1, patchIndex: 0 }],
        }),
      ],
    });
  });
});
