import {
  calculateCandidate,
  candidateRowData,
  givenNewTableRowCandidate,
  givenSelectedCandidate,
  requireCandidateRequirements,
  requireTableEntry,
} from './support/candidate-scenario';
import { CANDIDATE_ROW_ID } from './support/candidate-scenario';
import { CATALOGUE_TABLE_CREATED_ID } from 'src/features/draft-changes/__tests__/catalogue/support/catalogue-scenario';
import {
  givenSchemaPatchGroups,
  numberField,
  addField,
  removeField,
  rowInput,
  stringField,
} from 'src/features/draft-changes/__tests__/schema/support/schema-projection-fixture';

describe('draft changes mixed lifecycle prerequisites', () => {
  it('drops an invalid created row when its selected schema change is discarded', async () => {
    const headSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['title'],
      properties: { title: stringField() },
    } satisfies JsonSchema;
    const addedPrice = givenSchemaPatchGroups(headSchema, [
      [addField('/properties/price', numberField())],
    ]);
    const { data } = await givenSelectedCandidate({
      operation: 'discard',
      selection: {
        include: [
          {
            kind: 'schemaFields',
            tableId: 'products',
            paths: ['/properties/price'],
          },
          { kind: 'rows', tableId: 'products', rowIds: ['invalid-created'] },
        ],
      },
      scenario: {
        headSchema,
        draftSchema: addedPrice.terminalSchema,
        pending: addedPrice.steps,
        headRows: [],
        draftRows: [
          rowInput('invalid-created', { title: 'Invalid', price: 17 }),
        ],
      },
    });

    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    expect(
      candidateRowData(
        result,
        'draft',
        CATALOGUE_TABLE_CREATED_ID,
        'invalid-created',
      ),
    ).toBeUndefined();
  });

  it('blocks a schema removal that changes a hard-denied old Head field', async () => {
    const headSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'price'],
      properties: { title: stringField(), price: numberField() },
    } satisfies JsonSchema;
    const removedPrice = givenSchemaPatchGroups(headSchema, [
      [removeField('/properties/price')],
    ]);
    const { data } = await givenSelectedCandidate({
      operation: 'commit',
      selection: {
        include: [
          {
            kind: 'schemaFields',
            tableId: 'products',
            paths: ['/properties/price'],
          },
        ],
        exclude: [
          {
            kind: 'rowFields',
            tableId: 'products',
            rowId: CANDIDATE_ROW_ID,
            paths: ['/price'],
          },
        ],
      },
      scenario: {
        headSchema,
        draftSchema: removedPrice.terminalSchema,
        pending: removedPrice.steps,
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
          tableCreatedId: CATALOGUE_TABLE_CREATED_ID,
          path: '/price',
        }),
      ],
    });
  });

  it('requires the exact table creation before publishing a selected new-table row', async () => {
    const { data, catalogue } = await givenNewTableRowCandidate();
    const tableEntry = requireTableEntry(catalogue);

    const result = await calculateCandidate(data);

    expect(result).toMatchObject({
      status: 'needsEffects',
      requirements: [
        expect.objectContaining({
          kind: 'catalogueEffects',
          role: 'head',
          refs: [tableEntry.ref],
        }),
      ],
    });
  });

  it('blocks a selected new-table row when its exact parent ref is denied', async () => {
    const { data } = await givenNewTableRowCandidate({
      denyTableCreation: true,
    });

    const result = await calculateCandidate(data);

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [expect.objectContaining({ code: 'EXCLUDED_PREREQUISITE' })],
    });
  });

  it('requires the field-add schema effect before committing a created row value', async () => {
    const headSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['price', 'title'],
      properties: { price: numberField(), title: stringField() },
    } satisfies JsonSchema;
    const added = givenSchemaPatchGroups(headSchema, [
      [addField('/properties/extra', numberField())],
    ]);
    const { data } = await givenSelectedCandidate({
      operation: 'commit',
      selection: {
        include: [{ kind: 'rows', tableId: 'products', rowIds: ['new-row'] }],
      },
      scenario: {
        headSchema,
        draftSchema: added.terminalSchema,
        pending: added.steps,
        headRows: [rowInput('existing', { title: 'Head', price: 10 })],
        draftRows: [
          rowInput('existing', { title: 'Head', price: 10, extra: 0 }),
          rowInput('new-row', { title: 'New', price: 0, extra: 7 }),
        ],
      },
    });

    const result = await calculateCandidate(data);
    expect(result.status).toBe('needsEffects');
    expect(requireCandidateRequirements(result).requirements).toContainEqual(
      expect.objectContaining({
        kind: 'schemaEffects',
        tableCreatedId: CATALOGUE_TABLE_CREATED_ID,
        effects: [{ historyIndex: 1, patchIndex: 0 }],
      }),
    );
  });
});
import type { JsonSchema } from '@revisium/schema-toolkit/types';
