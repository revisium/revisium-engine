import {
  calculateCandidate,
  CANDIDATE_ROW_ID,
  givenSelectedCandidate,
  productData,
  requireCandidateRowData,
  rowFields,
} from './support/candidate-scenario';
import { CATALOGUE_TABLE_CREATED_ID } from 'src/features/draft-changes/__tests__/catalogue/support/catalogue-scenario';
import {
  arraySchema,
  addField,
  givenSchemaPatchGroups,
  numberField,
  objectSchema,
  rowInput,
} from 'src/features/draft-changes/__tests__/schema/support/schema-projection-fixture';

describe('draft changes candidate atomic arrays', () => {
  it('commits a nested array as one value while preserving an independent field', async () => {
    const schema = objectSchema({
      items: arraySchema(objectSchema({ price: numberField() })),
      title: { type: 'string', default: '' },
    });
    const { data } = await givenSelectedCandidate({
      operation: 'commit',
      selection: rowFields('products', CANDIDATE_ROW_ID, ['/items']),
      scenario: {
        headSchema: schema,
        draftSchema: schema,
        headRows: [
          rowInput(CANDIDATE_ROW_ID, {
            items: [{ price: 10 }],
            title: 'Head',
          }),
        ],
        draftRows: [
          rowInput(CANDIDATE_ROW_ID, {
            items: [{ price: 11 }, { price: 20 }],
            title: 'Draft',
          }),
        ],
      },
    });

    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    expect(
      requireCandidateRowData(
        result,
        'head',
        CATALOGUE_TABLE_CREATED_ID,
        CANDIDATE_ROW_ID,
      ),
    ).toEqual({ items: [{ price: 11 }, { price: 20 }], title: 'Head' });
  });

  it('discards a nested array as one value', async () => {
    const schema = objectSchema({
      items: arraySchema(objectSchema({ price: numberField() })),
      title: { type: 'string', default: '' },
    });
    const { data } = await givenSelectedCandidate({
      operation: 'discard',
      selection: rowFields('products', CANDIDATE_ROW_ID, ['/items']),
      scenario: {
        headSchema: schema,
        draftSchema: schema,
        headRows: [
          rowInput(CANDIDATE_ROW_ID, {
            items: [{ price: 10 }],
            title: 'Head',
          }),
        ],
        draftRows: [
          rowInput(CANDIDATE_ROW_ID, {
            items: [{ price: 11 }, { price: 20 }],
            title: 'Draft',
          }),
        ],
      },
    });

    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    expect(
      requireCandidateRowData(
        result,
        'draft',
        CATALOGUE_TABLE_CREATED_ID,
        CANDIDATE_ROW_ID,
      ),
    ).toEqual({ items: [{ price: 10 }], title: 'Draft' });
  });

  it('commits a root array through its atomic root pointer', async () => {
    const schema = arraySchema(objectSchema({ price: numberField() }));
    const { data } = await givenSelectedCandidate({
      operation: 'commit',
      selection: rowFields('products', CANDIDATE_ROW_ID, ['']),
      scenario: {
        headSchema: schema,
        draftSchema: schema,
        headRows: [rowInput(CANDIDATE_ROW_ID, [{ price: 10 }])],
        draftRows: [rowInput(CANDIDATE_ROW_ID, [{ price: 11 }, { price: 20 }])],
      },
    });

    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    expect(
      requireCandidateRowData(
        result,
        'head',
        CATALOGUE_TABLE_CREATED_ID,
        CANDIDATE_ROW_ID,
      ),
    ).toEqual([{ price: 11 }, { price: 20 }]);
  });

  it('discards a root array through its atomic root pointer', async () => {
    const schema = arraySchema(objectSchema({ price: numberField() }));
    const { data } = await givenSelectedCandidate({
      operation: 'discard',
      selection: rowFields('products', CANDIDATE_ROW_ID, ['']),
      scenario: {
        headSchema: schema,
        draftSchema: schema,
        headRows: [rowInput(CANDIDATE_ROW_ID, [{ price: 10 }])],
        draftRows: [rowInput(CANDIDATE_ROW_ID, [{ price: 11 }, { price: 20 }])],
      },
    });

    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    expect(productData(result, 'draft')).toEqual([{ price: 10 }]);
  });

  it('keeps a discarded nested array on the retained schema baseline', async () => {
    const headSchema = objectSchema({
      items: arraySchema(objectSchema({ price: numberField() })),
      title: { type: 'string', default: '' },
    });
    const added = givenSchemaPatchGroups(headSchema, [
      [addField('/properties/items/items/properties/extra', numberField())],
    ]);
    const { data } = await givenSelectedCandidate({
      operation: 'discard',
      selection: {
        include: [
          {
            kind: 'schemaFields',
            tableId: 'products',
            paths: ['/properties/items/items/properties/extra'],
          },
          {
            kind: 'rowFields',
            tableId: 'products',
            rowId: CANDIDATE_ROW_ID,
            paths: ['/items'],
          },
        ],
      },
      scenario: {
        headSchema,
        draftSchema: added.terminalSchema,
        pending: added.steps,
        headRows: [
          rowInput(CANDIDATE_ROW_ID, { title: 'Head', items: [{ price: 10 }] }),
        ],
        draftRows: [
          rowInput(CANDIDATE_ROW_ID, {
            title: 'Draft',
            items: [{ price: 11, extra: 3 }],
          }),
        ],
      },
    });

    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    expect(productData(result, 'draft')).toEqual({
      title: 'Draft',
      items: [{ price: 10 }],
    });
  });

  it('keeps a discarded root array on the retained schema baseline', async () => {
    const headSchema = arraySchema(objectSchema({ price: numberField() }));
    const added = givenSchemaPatchGroups(headSchema, [
      [addField('/items/properties/extra', numberField())],
    ]);
    const { data } = await givenSelectedCandidate({
      operation: 'discard',
      selection: {
        include: [
          {
            kind: 'schemaFields',
            tableId: 'products',
            paths: ['/items/properties/extra'],
          },
          {
            kind: 'rowFields',
            tableId: 'products',
            rowId: CANDIDATE_ROW_ID,
            paths: [''],
          },
        ],
      },
      scenario: {
        headSchema,
        draftSchema: added.terminalSchema,
        pending: added.steps,
        headRows: [rowInput(CANDIDATE_ROW_ID, [{ price: 10 }])],
        draftRows: [rowInput(CANDIDATE_ROW_ID, [{ price: 11, extra: 3 }])],
      },
    });

    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    expect(productData(result, 'draft')).toEqual([{ price: 10 }]);
  });
});
