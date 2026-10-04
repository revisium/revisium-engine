import {
  calculateCandidate,
  candidateRowId,
  candidateSchemaRowIdentity,
  candidateTableId,
  givenCaseInsensitiveTableConflictCandidate,
  givenSelectedCandidate,
  givenSelectedRowLifecycleCandidate,
  givenTableIdSwapCandidate,
  givenTableIdSwapWithTemporaryNameCollision,
  requireRowLifecycleEntry,
  requireCandidateRequirements,
  sourceSchemaRowIdentity,
} from './support/candidate-scenario';
import { CATALOGUE_TABLE_CREATED_ID } from 'src/features/draft-changes/__tests__/catalogue/support/catalogue-scenario';
import { rowInput } from 'src/features/draft-changes/__tests__/schema/support/schema-projection-fixture';

describe('draft changes candidate identity', () => {
  it('commits both sides of a row ID swap by stable row identity', async () => {
    const { data } = await givenSelectedCandidate({
      operation: 'commit',
      selection: {
        include: [{ kind: 'rows', tableId: 'products', rowIds: 'all' }],
      },
      scenario: {
        headRows: [
          rowInput('row-a', { title: 'A', price: 1 }),
          rowInput('row-b', { title: 'B', price: 2 }),
        ],
        draftRows: [
          rowInput('row-a', { title: 'A', price: 1 }),
          rowInput('row-b', { title: 'B', price: 2 }),
        ],
        headRowIds: { 'row-a': 'a', 'row-b': 'b' },
        draftRowIds: { 'row-a': 'b', 'row-b': 'a' },
      },
    });

    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    expect(
      candidateRowId(result, 'head', CATALOGUE_TABLE_CREATED_ID, 'row-a'),
    ).toBe('b');
    expect(
      candidateRowId(result, 'head', CATALOGUE_TABLE_CREATED_ID, 'row-b'),
    ).toBe('a');
  });

  it('requires the exact old identity deletion before reusing its public row ID', async () => {
    const { data, catalogue } = await givenSelectedRowLifecycleCandidate({
      operation: 'commit',
      rowCreatedId: 'new',
      scenario: {
        headRows: [rowInput('old', { title: 'Old', price: 1 })],
        draftRows: [rowInput('new', { title: 'New', price: 2 })],
        headRowIds: { old: 'reused-id' },
        draftRowIds: { new: 'reused-id' },
      },
    });

    const result = await calculateCandidate(data);

    expect(result.status).toBe('needsEffects');
    const requirement = requireCandidateRequirements(result).requirements[0];
    expect(requirement).toEqual(
      expect.objectContaining({
        kind: 'catalogueEffects',
        refs: [requireRowLifecycleEntry(catalogue, 'old').ref],
      }),
    );
  });

  it('keeps a recreated Draft identity when committing the prior identity deletion', async () => {
    const { data } = await givenSelectedRowLifecycleCandidate({
      operation: 'commit',
      rowCreatedId: 'old-row',
      scenario: {
        headRows: [rowInput('old-row', { title: 'Old', price: 1 })],
        draftRows: [rowInput('new-row', { title: 'Recreated', price: 2 })],
        headRowIds: { 'old-row': 'reused-id' },
        draftRowIds: { 'new-row': 'reused-id' },
      },
    });

    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    expect(
      candidateRowId(result, 'draft', CATALOGUE_TABLE_CREATED_ID, 'new-row'),
    ).toBe('reused-id');
  });

  it.each([
    ['commit', 'head', 'secondary-products', 'products'],
    ['discard', 'draft', 'products', 'secondary-products'],
  ] as const)(
    'swaps table names and their schema row identities during %s',
    async (operation, role, primaryId, secondaryId) => {
      const data = await givenTableIdSwapCandidate(operation);
      const result = await calculateCandidate(data);

      expect(result.status).toBe('calculated');
      expect(candidateTableId(result, role, CATALOGUE_TABLE_CREATED_ID)).toBe(
        primaryId,
      );
      expect(candidateTableId(result, role, 'stable-secondary-products')).toBe(
        secondaryId,
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
        candidateSchemaRowIdentity(result, role, 'stable-secondary-products'),
      ).toEqual(
        sourceSchemaRowIdentity(
          data.snapshot,
          role,
          'stable-secondary-products',
        ),
      );
    },
  );

  it('preserves an unselected schema row whose public ID matches the old rename sentinel', async () => {
    const data = await givenTableIdSwapWithTemporaryNameCollision();
    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    expect(
      candidateSchemaRowIdentity(result, 'head', 'stable-collision-table'),
    ).toEqual(
      sourceSchemaRowIdentity(data.snapshot, 'head', 'stable-collision-table'),
    );
  });

  it('requires the unique conflicting table rename using case-insensitive IDs', async () => {
    const { data, conflictingRef } =
      await givenCaseInsensitiveTableConflictCandidate();
    const result = await calculateCandidate(data);

    expect(result.status).toBe('needsEffects');
    expect(requireCandidateRequirements(result).requirements).toContainEqual(
      expect.objectContaining({
        kind: 'catalogueEffects',
        refs: [conflictingRef],
      }),
    );
  });

  it('requires the row occupying a selected discard identity', async () => {
    const { data, catalogue } = await givenSelectedRowLifecycleCandidate({
      operation: 'discard',
      rowCreatedId: 'row-a',
      scenario: {
        headRows: [
          rowInput('row-a', { title: 'A', price: 1 }),
          rowInput('row-b', { title: 'B', price: 2 }),
        ],
        draftRows: [
          rowInput('row-a', { title: 'A', price: 1 }),
          rowInput('row-b', { title: 'B', price: 2 }),
        ],
        headRowIds: { 'row-a': 'a', 'row-b': 'b' },
        draftRowIds: { 'row-a': 'b', 'row-b': 'a' },
      },
    });
    const prerequisite = requireRowLifecycleEntry(catalogue, 'row-b');

    const result = await calculateCandidate(data);

    expect(result).toMatchObject({
      status: 'needsEffects',
      requirements: [
        expect.objectContaining({
          kind: 'catalogueEffects',
          role: 'draft',
          refs: [prerequisite.ref],
        }),
      ],
    });
  });
});
