import {
  calculateCandidate,
  candidateSchemaRowIdentity,
  candidateTableId,
  candidateTablePresent,
  candidateTableRowIds,
  givenOneSidedTableCandidate,
  givenSelectedTableLifecycleCandidate,
  requireCandidateRowData,
  requireRowLifecycleEntry,
  sourceSchemaRowIdentity,
  NEW_TABLE_CREATED_ID,
} from './support/candidate-scenario';
import { CATALOGUE_TABLE_CREATED_ID } from 'src/features/draft-changes/__tests__/catalogue/support/catalogue-scenario';
import { rowInput } from 'src/features/draft-changes/__tests__/schema/support/schema-projection-fixture';

describe('draft changes candidate table lifecycle', () => {
  it('creates an empty table when rows:none is selected', async () => {
    const { data } = await givenOneSidedTableCandidate({
      side: 'draft',
      operation: 'commit',
      rows: [rowInput('one', { title: 'One', price: 1 })],
      selection: {
        include: [{ kind: 'table', tableId: 'products', rows: 'none' }],
      },
    });

    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    expect(candidateTablePresent(result, 'head', 'new-table-created')).toBe(
      true,
    );
    expect(candidateTableId(result, 'head', 'new-table-created')).toBe(
      'products',
    );
    expect(candidateTableRowIds(result, 'head', 'new-table-created')).toEqual(
      [],
    );
  });

  it('deletes a selected table with default row scope from Head', async () => {
    const { data } = await givenOneSidedTableCandidate({
      side: 'head',
      operation: 'commit',
      rows: [rowInput('one', { title: 'One', price: 1 })],
      selection: { include: [{ kind: 'table', tableId: 'products' }] },
    });

    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    expect(candidateTablePresent(result, 'head', 'new-table-created')).toBe(
      false,
    );
  });

  it('requires the selected row deletion before removing a populated table', async () => {
    const { data, catalogue } = await givenOneSidedTableCandidate({
      side: 'head',
      operation: 'commit',
      rows: [rowInput('one', { title: 'One', price: 1 })],
      selection: {
        include: [{ kind: 'table', tableId: 'products', rows: 'none' }],
      },
    });
    const row = requireRowLifecycleEntry(catalogue, 'one');

    const result = await calculateCandidate(data);

    expect(result).toMatchObject({
      status: 'needsEffects',
      requirements: [
        expect.objectContaining({ kind: 'catalogueEffects', refs: [row.ref] }),
      ],
    });
  });

  it('requires row deletions before discarding a populated created table', async () => {
    const { data, catalogue } = await givenOneSidedTableCandidate({
      side: 'draft',
      operation: 'discard',
      rows: [rowInput('one', { title: 'One', price: 1 })],
      selection: {
        include: [{ kind: 'table', tableId: 'products', rows: 'none' }],
      },
    });
    const row = requireRowLifecycleEntry(catalogue, 'one');

    const result = await calculateCandidate(data);

    expect(result).toMatchObject({
      status: 'needsEffects',
      requirements: [
        expect.objectContaining({ kind: 'catalogueEffects', refs: [row.ref] }),
      ],
    });
  });

  it('restores an empty table when discarding deletion with rows:none', async () => {
    const { data } = await givenOneSidedTableCandidate({
      side: 'head',
      operation: 'discard',
      rows: [rowInput('one', { title: 'One', price: 1 })],
      selection: {
        include: [{ kind: 'table', tableId: 'products', rows: 'none' }],
      },
    });

    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    expect(candidateTablePresent(result, 'draft', 'new-table-created')).toBe(
      true,
    );
    expect(candidateTableRowIds(result, 'draft', 'new-table-created')).toEqual(
      [],
    );
  });

  it('blocks table removal when the required row lifecycle is denied', async () => {
    const { data } = await givenOneSidedTableCandidate({
      side: 'head',
      operation: 'commit',
      rows: [rowInput('one', { title: 'One', price: 1 })],
      selection: {
        include: [{ kind: 'table', tableId: 'products', rows: 'none' }],
        exclude: [{ kind: 'rows', tableId: 'products', rowIds: ['one'] }],
      },
    });

    const result = await calculateCandidate(data);

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [
        expect.objectContaining({
          code: 'EXCLUDED_PREREQUISITE',
          role: 'head',
          tableCreatedId: NEW_TABLE_CREATED_ID,
          rowCreatedId: 'one',
        }),
      ],
    });
  });

  it('restores a table deletion to Draft without copying another role', async () => {
    const { data } = await givenOneSidedTableCandidate({
      side: 'head',
      operation: 'discard',
      rows: [rowInput('restored-row', { title: 'Head', price: 10 })],
      selection: { include: [{ kind: 'table', tableId: 'products' }] },
    });

    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    expect(candidateTablePresent(result, 'draft', 'new-table-created')).toBe(
      true,
    );
    expect(
      requireCandidateRowData(
        result,
        'draft',
        'new-table-created',
        'restored-row',
      ),
    ).toEqual({ title: 'Head', price: 10 });
  });

  it.each([
    ['commit', 'head', 'renamed-products', { title: 'Head', price: 10 }],
    ['discard', 'draft', 'products', { title: 'Draft', price: 20 }],
  ] as const)(
    'applies the table rename during %s and preserves the independent row edit',
    async (operation, role, expectedId, expectedData) => {
      const { data } = await givenSelectedTableLifecycleCandidate({
        operation,
        scenario: {
          headTableId: 'products',
          draftTableId: 'renamed-products',
          headRows: [rowInput('product', { title: 'Head', price: 10 })],
          draftRows: [rowInput('product', { title: 'Draft', price: 20 })],
        },
      });

      const result = await calculateCandidate(data);

      expect(result.status).toBe('calculated');
      expect(candidateTableId(result, role, CATALOGUE_TABLE_CREATED_ID)).toBe(
        expectedId,
      );
      expect(
        candidateSchemaRowIdentity(result, role, CATALOGUE_TABLE_CREATED_ID),
      ).toEqual(
        sourceSchemaRowIdentity(
          data.snapshot,
          role,
          CATALOGUE_TABLE_CREATED_ID,
        ),
      );
      expect(
        requireCandidateRowData(
          result,
          role,
          CATALOGUE_TABLE_CREATED_ID,
          'product',
        ),
      ).toEqual(expectedData);
    },
  );
});
