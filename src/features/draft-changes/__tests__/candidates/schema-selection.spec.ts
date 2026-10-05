import {
  calculateCandidate,
  candidateTableSchema,
  CANDIDATE_ROW_ID,
  givenSelectedCandidate,
  productData,
  requireCandidateRequirements,
  requireSchemaEntry,
  schemaFields,
  schemaWith,
} from './support/candidate-scenario';
import { CATALOGUE_TABLE_CREATED_ID } from 'src/features/draft-changes/__tests__/catalogue/support/catalogue-scenario';
import {
  addField,
  moveField,
  numberField,
  rowInput,
  stringField,
  givenSchemaPatchGroups,
} from 'src/features/draft-changes/__tests__/schema/support/schema-projection-fixture';

describe('draft changes candidate schema selection', () => {
  it('commits one schema sibling while leaving the other grouped effect pending', async () => {
    const headSchema = schemaWith({ title: stringField() });
    const grouped = givenSchemaPatchGroups(headSchema, [
      [
        addField('/properties/alpha', stringField()),
        addField('/properties/beta', numberField()),
      ],
    ]);
    const { data } = await givenSelectedCandidate({
      operation: 'commit',
      selection: schemaFields('products', ['/properties/alpha']),
      scenario: {
        headSchema,
        draftSchema: grouped.terminalSchema,
        pending: grouped.steps,
        headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head' })],
        draftRows: [
          rowInput(CANDIDATE_ROW_ID, {
            title: 'Head',
            alpha: 'selected',
            beta: 2,
          }),
        ],
      },
    });

    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    expect(
      candidateTableSchema(result, 'head', CATALOGUE_TABLE_CREATED_ID),
    ).toMatchObject({
      properties: { alpha: expect.any(Object) },
    });
    expect(
      candidateTableSchema(result, 'head', CATALOGUE_TABLE_CREATED_ID),
    ).not.toHaveProperty('properties.beta');
    expect(productData(result, 'head')).toEqual({ title: 'Head', alpha: '' });
    expect(productData(result, 'draft')).toEqual({
      title: 'Head',
      alpha: 'selected',
      beta: 2,
    });
  });

  it('commits a selected schema effect with its selected new-field value', async () => {
    const headSchema = schemaWith({ title: stringField() });
    const added = givenSchemaPatchGroups(headSchema, [
      [addField('/properties/extra', numberField())],
    ]);
    const { data } = await givenSelectedCandidate({
      operation: 'commit',
      selection: {
        include: [
          {
            kind: 'schemaFields',
            tableId: 'products',
            paths: ['/properties/extra'],
          },
          {
            kind: 'rowFields',
            tableId: 'products',
            rowId: CANDIDATE_ROW_ID,
            paths: ['/extra'],
          },
        ],
      },
      scenario: {
        headSchema,
        draftSchema: added.terminalSchema,
        pending: added.steps,
        headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head' })],
        draftRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Draft', extra: 7 })],
      },
    });

    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    expect(productData(result, 'head')).toEqual({ title: 'Head', extra: 7 });
    expect(productData(result, 'draft')).toEqual({ title: 'Draft', extra: 7 });
  });

  it('maps a selected value through a rename chain recorded in separate groups', async () => {
    const headSchema = schemaWith({
      title: stringField(),
      price: numberField(),
    });
    const renamed = givenSchemaPatchGroups(headSchema, [
      [moveField('/properties/price', '/properties/cost')],
      [moveField('/properties/cost', '/properties/amount')],
    ]);
    const { data } = await givenSelectedCandidate({
      operation: 'commit',
      selection: { include: [{ kind: 'all' }] },
      scenario: {
        headSchema,
        draftSchema: renamed.terminalSchema,
        pending: renamed.steps,
        headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head', price: 10 })],
        draftRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Draft', amount: 20 })],
      },
    });

    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    expect(productData(result, 'head')).toEqual({ title: 'Draft', amount: 20 });
  });

  it('requires confirmation before discarding an added schema field with Draft data', async () => {
    const headSchema = schemaWith({ title: stringField() });
    const addedField = givenSchemaPatchGroups(headSchema, [
      [addField('/properties/extra', numberField())],
    ]);
    const { data, catalogue } = await givenSelectedCandidate({
      operation: 'discard',
      selection: schemaFields('products', ['/properties/extra']),
      scenario: {
        headSchema,
        draftSchema: addedField.terminalSchema,
        pending: addedField.steps,
        headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head' })],
        draftRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Draft', extra: 7 })],
      },
    });
    const schemaEntry = requireSchemaEntry(catalogue, '/properties/extra');

    const result = await calculateCandidate(data);

    expect(result.status).toBe('needsEffects');
    const requirements = requireCandidateRequirements(result);
    expect(requirements.requirements).toContainEqual(
      expect.objectContaining({
        kind: 'discardDataFields',
        role: 'draft',
        causeRef: schemaEntry.ref,
        tableCreatedId: CATALOGUE_TABLE_CREATED_ID,
        fields: [{ rowCreatedId: CANDIDATE_ROW_ID, path: '/extra' }],
      }),
    );
  });
});
