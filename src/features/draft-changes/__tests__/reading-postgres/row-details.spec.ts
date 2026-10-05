import {
  getArraySchema,
  getNumberSchema,
  getObjectSchema,
} from '@revisium/schema-toolkit/mocks';
import { NotFoundException } from '@nestjs/common';
import { givenReadingScenario } from './support/reading-scenario';
import { useReadingTestKit } from './support/reading-test-kit';

describe('Draft Changes reader: row details', () => {
  const kit = useReadingTestKit();

  it('returns an exact catalogue ref that selects the same field', async () => {
    const scenario = await givenReadingScenario(kit(), {
      head: { title: 'Head' },
      draft: { title: 'Draft' },
    });
    const catalogue = await scenario.readCatalogue();

    const details = await kit().changes.draftRowChanges({
      ...scenario.branch,
      tableId: scenario.tableId,
      rowId: scenario.rowId,
    });
    const ref = details.changes[0]?.ref;
    if (!ref) {
      throw new Error('Expected a changed field reference.');
    }
    const selected = await kit().changes.resolveSelection({
      catalogue,
      selection: { include: [{ kind: 'change', ref }] },
    });

    expect(selected).toMatchObject({
      status: 'resolved',
      selected: [expect.objectContaining({ kind: 'rowField', path: '/title' })],
    });
  });

  it('uses the migrated Head value at the current schema pointer after a rename', async () => {
    const scenario = await givenReadingScenario(kit(), {
      head: { price: 10 },
      draft: { price: 20 },
    });
    await scenario.patchDraftSchema([
      { op: 'move', from: '/properties/price', path: '/properties/cost' },
    ]);
    const catalogue = await scenario.readCatalogue();
    const catalogueEntry = catalogue.entries.find(
      ({ kind, path }) => kind === 'rowField' && path === '/cost',
    );

    const details = await kit().changes.draftRowChanges({
      ...scenario.branch,
      tableId: scenario.tableId,
      rowId: scenario.rowId,
    });
    const field = details.changes.find(
      ({ effect }) => effect?.path === '/cost',
    );

    expect(field).toMatchObject({
      selectable: true,
      effect: { before: 10, after: 20 },
    });
    expect(field?.ref).toEqual(catalogueEntry?.ref);
  });

  it('resolves an unambiguous previous row ID to current details', async () => {
    const scenario = await givenReadingScenario(kit(), {
      head: { title: 'Head' },
      draft: { title: 'Draft' },
      rowId: 'previous-name',
    });
    await scenario.renameDraftRow('current-name');

    const details = await kit().changes.draftRowChanges({
      ...scenario.branch,
      tableId: scenario.tableId,
      rowId: 'previous-name',
    });

    expect(details.rowId).toBe('current-name');
  });

  it('rejects details for an unknown row', async () => {
    const scenario = await givenReadingScenario(kit(), {
      head: { title: 'Head' },
    });

    await expect(
      kit().changes.draftRowChanges({
        ...scenario.branch,
        tableId: scenario.tableId,
        rowId: 'missing-row',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps a changed array as one atomic selectable leaf', async () => {
    const schema = getObjectSchema({
      items: getArraySchema(getNumberSchema()),
    });
    const scenario = await givenReadingScenario(kit(), {
      head: { items: [1, 2] },
      draft: { items: [1, 3] },
      schema,
    });

    const details = await kit().changes.draftRowChanges({
      ...scenario.branch,
      tableId: scenario.tableId,
      rowId: scenario.rowId,
    });

    expect(details.changes).toEqual([
      expect.objectContaining({
        kind: 'atomic',
        selectable: true,
        effect: expect.objectContaining({ path: '/items' }),
      }),
    ]);
  });

  it('defaults row detail reads to the first 100 leaves while preserving totalCount', async () => {
    const head = Object.fromEntries(
      Array.from({ length: 101 }, (_, index) => [`field${index}`, 0]),
    );
    const draft = Object.fromEntries(
      Array.from({ length: 101 }, (_, index) => [`field${index}`, 1]),
    );
    const scenario = await givenReadingScenario(kit(), { head, draft });

    const details = await kit().changes.draftRowChanges({
      ...scenario.branch,
      tableId: scenario.tableId,
      rowId: scenario.rowId,
    });

    expect(details.changes).toHaveLength(100);
    expect(details.totalCount).toBe(101);
    expect(details.pageInfo.hasNextPage).toBe(true);
  });

  it('walks row detail refs through a final one-item page', async () => {
    const scenario = await givenReadingScenario(kit(), {
      head: { first: 0, second: 0 },
      draft: { first: 1, second: 1 },
    });
    const catalogue = await scenario.readCatalogue();
    const first = await kit().changes.draftRowChanges({
      ...scenario.branch,
      tableId: scenario.tableId,
      rowId: scenario.rowId,
      page: { first: 1 },
    });
    const firstCursor = first.pageInfo.endCursor;
    if (!firstCursor || !first.changes[0]?.ref.value) {
      throw new Error('Expected a nonempty first page with an edge cursor.');
    }
    const second = await kit().changes.draftRowChanges({
      ...scenario.branch,
      tableId: scenario.tableId,
      rowId: scenario.rowId,
      page: { first: 1, after: firstCursor },
    });
    const catalogueRefs = catalogue.entries
      .filter(
        ({ kind, path }) =>
          kind === 'rowField' && ['/first', '/second'].includes(path ?? ''),
      )
      .map(({ ref }) => ref.value);
    const pageRefs = [...first.changes, ...second.changes].map(
      ({ ref }) => ref.value,
    );

    expect(first.totalCount).toBe(2);
    expect(second.totalCount).toBe(2);
    expect(first.changes).toHaveLength(1);
    expect(second.changes).toHaveLength(1);
    expect(second.changes[0]?.ref.value).not.toBe(first.changes[0]?.ref.value);
    expect(catalogueRefs).toHaveLength(2);
    expect(pageRefs.sort()).toEqual(catalogueRefs.sort());
    expect(second.pageInfo.hasNextPage).toBe(false);
    expect(requireCursor(second.pageInfo.endCursor)).toBeTruthy();
  });
});

function requireCursor(cursor: string | null): string {
  if (!cursor) {
    throw new Error('Expected a nonempty page cursor.');
  }
  return cursor;
}
