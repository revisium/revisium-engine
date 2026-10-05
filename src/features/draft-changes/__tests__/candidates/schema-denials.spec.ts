import {
  calculateCandidate,
  CANDIDATE_ROW_ID,
  givenSelectedCandidate,
  givenRenamedChildWithDeniedDraftField,
  givenSchemaChangeDeniedByExactFieldRef,
  givenCommitNoteWithDeniedSchemaRename,
  givenCommitCreatedRowWithDeniedTableRename,
  givenCommitChildSchemaWithDeniedParentMove,
  rowFields,
  schemaFields,
  schemaWith,
  requireCandidateRowData,
} from './support/candidate-scenario';
import { CATALOGUE_TABLE_CREATED_ID } from 'src/features/draft-changes/__tests__/catalogue/support/catalogue-scenario';
import {
  addField,
  numberField,
  removeField,
  rowInput,
  stringField,
  givenSchemaPatchGroups,
} from 'src/features/draft-changes/__tests__/schema/support/schema-projection-fixture';

describe('draft changes candidate schema denials', () => {
  it('maps a denied Draft field through a pending parent move', async () => {
    const { data } = await givenRenamedChildWithDeniedDraftField();

    const result = await calculateCandidate(data);

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [expect.objectContaining({ code: 'EXCLUDED_PREREQUISITE' })],
    });
  });

  it('blocks a schema change denied by the exact changed-field reference', async () => {
    const { data } = await givenSchemaChangeDeniedByExactFieldRef();

    const result = await calculateCandidate(data);

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [expect.objectContaining({ code: 'EXCLUDED_PREREQUISITE' })],
    });
  });

  it('blocks schema removal when the entire old row is denied', async () => {
    const headSchema = schemaWith({
      title: stringField(),
      price: numberField(),
    });
    const removed = givenSchemaPatchGroups(headSchema, [
      [removeField('/properties/price')],
    ]);
    const { data } = await givenSelectedCandidate({
      operation: 'commit',
      selection: {
        include: schemaFields('products', ['/properties/price']).include,
        exclude: [
          { kind: 'rows', tableId: 'products', rowIds: [CANDIDATE_ROW_ID] },
        ],
      },
      scenario: {
        headSchema,
        draftSchema: removed.terminalSchema,
        pending: removed.steps,
        headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head', price: 10 })],
        draftRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Draft' })],
      },
    });

    const result = await calculateCandidate(data);

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [
        expect.objectContaining({
          code: 'EXCLUDED_PREREQUISITE',
          role: 'head',
          rowCreatedId: CANDIDATE_ROW_ID,
        }),
      ],
    });
  });

  it('blocks when the schema needed for a selected array value is denied', async () => {
    const headSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['items', 'title'],
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['price'],
            properties: { price: numberField() },
          },
        },
        title: stringField(),
      },
    } satisfies JsonSchema;
    const added = givenSchemaPatchGroups(headSchema, [
      [addField('/properties/items/items/properties/extra', numberField())],
    ]);
    const { data } = await givenSelectedCandidate({
      operation: 'commit',
      selection: {
        include: [
          {
            kind: 'rowFields',
            tableId: 'products',
            rowId: CANDIDATE_ROW_ID,
            paths: ['/items'],
          },
        ],
        exclude: [{ kind: 'schemaFields', tableId: 'products', paths: 'all' }],
      },
      scenario: {
        headSchema,
        draftSchema: added.terminalSchema,
        pending: added.steps,
        headRows: [
          rowInput(CANDIDATE_ROW_ID, { title: 'Head', items: [{ price: 1 }] }),
        ],
        draftRows: [
          rowInput(CANDIDATE_ROW_ID, {
            title: 'Draft',
            items: [{ price: 2, extra: 3 }],
          }),
        ],
      },
    });

    const result = await calculateCandidate(data);

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [expect.objectContaining({ code: 'EXCLUDED_PREREQUISITE' })],
    });
  });

  it('blocks when a table-level schema facet denies a required field schema', async () => {
    const headSchema = schemaWith({ title: stringField() });
    const added = givenSchemaPatchGroups(headSchema, [
      [addField('/properties/extra', numberField())],
    ]);
    const { data } = await givenSelectedCandidate({
      operation: 'commit',
      selection: {
        include: rowFields('products', CANDIDATE_ROW_ID, ['/extra']).include,
        exclude: [{ kind: 'table', tableId: 'products', rows: 'none' }],
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

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [expect.objectContaining({ code: 'EXCLUDED_PREREQUISITE' })],
    });
  });

  it('blocks a denied field instead of returning its discard confirmation', async () => {
    const headSchema = schemaWith({ title: stringField() });
    const added = givenSchemaPatchGroups(headSchema, [
      [addField('/properties/extra', numberField())],
    ]);
    const { data } = await givenSelectedCandidate({
      operation: 'discard',
      selection: {
        include: schemaFields('products', ['/properties/extra']).include,
        exclude: [
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

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [expect.objectContaining({ code: 'EXCLUDED_PREREQUISITE' })],
    });
  });

  it('allows a row creation when only the table rename is denied', async () => {
    const data = await givenCommitCreatedRowWithDeniedTableRename();

    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    expect(
      requireCandidateRowData(
        result,
        'head',
        CATALOGUE_TABLE_CREATED_ID,
        'created-row',
      ),
    ).toEqual({ title: 'Created', price: 2 });
  });

  it('allows a row value commit when only a schema rename is denied', async () => {
    const data = await givenCommitNoteWithDeniedSchemaRename();

    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    expect(
      requireCandidateRowData(
        result,
        'head',
        CATALOGUE_TABLE_CREATED_ID,
        CANDIDATE_ROW_ID,
      ),
    ).toEqual({ old: 'Head', note: 'Draft' });
  });

  it('keeps a parent move pending when its child schema effect is selected', async () => {
    const data = await givenCommitChildSchemaWithDeniedParentMove();

    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
  });
});
import type { JsonSchema } from '@revisium/schema-toolkit/types';
