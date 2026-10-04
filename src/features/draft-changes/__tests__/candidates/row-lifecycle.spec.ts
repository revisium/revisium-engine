import {
  candidateRowData,
  candidateRowIntegrity,
  candidateRowReadonly,
  candidateRowId,
  calculateCandidate,
  CANDIDATE_ROW_ID,
  givenSelectedRowLifecycleCandidate,
  givenSelectedCandidate,
  productData,
  requireCandidateRowData,
  givenOneSidedTableCandidate,
  requireTableEntry,
  rowLifecycle,
} from './support/candidate-scenario';
import { CATALOGUE_TABLE_CREATED_ID } from 'src/features/draft-changes/__tests__/catalogue/support/catalogue-scenario';
import { rowInput } from 'src/features/draft-changes/__tests__/schema/support/schema-projection-fixture';
import objectHash from 'object-hash';
import {
  givenSchemaPatchGroups,
  addField,
  numberField,
  stringField,
} from 'src/features/draft-changes/__tests__/schema/support/schema-projection-fixture';

describe('draft changes candidate row lifecycle', () => {
  it('publishes one selected created row without an unselected sibling', async () => {
    const { data } = await givenSelectedCandidate({
      operation: 'commit',
      selection: rowLifecycle('products', ['new-row']),
      scenario: {
        headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head', price: 10 })],
        draftRows: [
          rowInput(CANDIDATE_ROW_ID, { title: 'Head', price: 10 }),
          rowInput('new-row', { title: 'Created', price: 20 }),
          rowInput('other-row', { title: 'Pending', price: 30 }),
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
        'new-row',
      ),
    ).toEqual({ title: 'Created', price: 20 });
    expect(
      candidateRowData(result, 'head', CATALOGUE_TABLE_CREATED_ID, 'other-row'),
    ).toBeUndefined();
  });

  it('commits a selected row deletion by removing it from Head', async () => {
    const { data } = await givenSelectedRowLifecycleCandidate({
      operation: 'commit',
      rowCreatedId: 'deleted-row',
      scenario: {
        headRows: [
          rowInput(CANDIDATE_ROW_ID, { title: 'Keep', price: 10 }),
          rowInput('deleted-row', { title: 'Delete', price: 20 }),
        ],
        draftRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Keep', price: 10 })],
      },
    });

    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    expect(
      candidateRowData(
        result,
        'head',
        CATALOGUE_TABLE_CREATED_ID,
        'deleted-row',
      ),
    ).toBeUndefined();
  });

  it('discards a selected row deletion by restoring the Head row to Draft', async () => {
    const { data } = await givenSelectedRowLifecycleCandidate({
      operation: 'discard',
      rowCreatedId: 'deleted-row',
      scenario: {
        headRows: [
          rowInput(CANDIDATE_ROW_ID, { title: 'Keep', price: 10 }),
          rowInput('deleted-row', { title: 'Head value', price: 20 }),
        ],
        draftRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Keep', price: 10 })],
      },
    });

    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    expect(
      requireCandidateRowData(
        result,
        'draft',
        CATALOGUE_TABLE_CREATED_ID,
        'deleted-row',
      ),
    ).toEqual({ title: 'Head value', price: 20 });
  });

  it('requires the exact table restoration before restoring a deleted row', async () => {
    const { data, catalogue } = await givenOneSidedTableCandidate({
      side: 'head',
      operation: 'discard',
      rows: [rowInput('deleted-row', { title: 'Head', price: 20 })],
      selection: {
        include: [
          { kind: 'rows', tableId: 'products', rowIds: ['deleted-row'] },
        ],
      },
    });
    const table = requireTableEntry(catalogue);

    const result = await calculateCandidate(data);

    expect(result).toMatchObject({
      status: 'needsEffects',
      requirements: [
        expect.objectContaining({
          kind: 'catalogueEffects',
          refs: [table.ref],
        }),
      ],
    });
  });

  it('refreshes restored row hashes for the remaining Draft schema', async () => {
    const headSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'price'],
      properties: { title: stringField(), price: numberField() },
    } satisfies JsonSchema;
    const added = givenSchemaPatchGroups(headSchema, [
      [addField('/properties/extra', numberField())],
    ]);
    const { data } = await givenSelectedRowLifecycleCandidate({
      operation: 'discard',
      rowCreatedId: 'deleted-row',
      scenario: {
        headSchema,
        draftSchema: added.terminalSchema,
        pending: added.steps,
        headRows: [rowInput('deleted-row', { title: 'Head', price: 20 })],
        draftRows: [],
      },
    });

    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    expect(
      candidateRowIntegrity(
        result,
        'draft',
        CATALOGUE_TABLE_CREATED_ID,
        'deleted-row',
      ),
    ).toMatchObject({
      hash: objectHash({ title: 'Head', price: 20, extra: 0 }),
      schemaHash: objectHash(added.terminalSchema),
    });
    expect(
      candidateRowReadonly(
        result,
        'draft',
        CATALOGUE_TABLE_CREATED_ID,
        'deleted-row',
      ),
    ).toBe(false);
  });

  it.each([
    ['commit', 'head', 'renamed-row', { title: 'Head', price: 10 }],
    ['discard', 'draft', 'original-row', { title: 'Draft', price: 20 }],
  ] as const)(
    'applies a selected row rename in %s while retaining the separate data edit',
    async (operation, role, expectedId, expectedData) => {
      const { data } = await givenSelectedRowLifecycleCandidate({
        operation,
        rowCreatedId: CANDIDATE_ROW_ID,
        scenario: {
          headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head', price: 10 })],
          draftRows: [
            rowInput(CANDIDATE_ROW_ID, { title: 'Draft', price: 20 }),
          ],
          headRowIds: { [CANDIDATE_ROW_ID]: 'original-row' },
          draftRowIds: { [CANDIDATE_ROW_ID]: 'renamed-row' },
        },
      });

      const result = await calculateCandidate(data);

      expect(result.status).toBe('calculated');
      expect(
        candidateRowId(
          result,
          role,
          CATALOGUE_TABLE_CREATED_ID,
          CANDIDATE_ROW_ID,
        ),
      ).toBe(expectedId);
      expect(
        requireCandidateRowData(
          result,
          role,
          CATALOGUE_TABLE_CREATED_ID,
          CANDIDATE_ROW_ID,
        ),
      ).toEqual(expectedData);
    },
  );

  it('treats row identifiers differing only by case as distinct', async () => {
    const { data } = await givenSelectedCandidate({
      operation: 'commit',
      selection: rowLifecycle('products', 'all'),
      scenario: {
        headRows: [
          rowInput(CANDIDATE_ROW_ID, { title: 'A', price: 1 }),
          rowInput('row-upper', { title: 'B', price: 2 }),
        ],
        draftRows: [
          rowInput(CANDIDATE_ROW_ID, { title: 'A', price: 1 }),
          rowInput('row-upper', { title: 'B', price: 2 }),
        ],
        headRowIds: { [CANDIDATE_ROW_ID]: 'row-a', 'row-upper': 'ROW-A' },
        draftRowIds: { [CANDIDATE_ROW_ID]: 'row-a', 'row-upper': 'ROW-A' },
      },
    });

    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    expect(productData(result, 'head')).toEqual({ title: 'A', price: 1 });
    expect(
      candidateRowId(
        result,
        'head',
        CATALOGUE_TABLE_CREATED_ID,
        CANDIDATE_ROW_ID,
      ),
    ).toBe('row-a');
    expect(
      candidateRowId(result, 'head', CATALOGUE_TABLE_CREATED_ID, 'row-upper'),
    ).toBe('ROW-A');
  });
});
import type { JsonSchema } from '@revisium/schema-toolkit/types';
