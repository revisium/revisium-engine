import {
  buildCatalogue,
  givenCatalogueScenario,
  withoutDataTable,
} from './support/catalogue-scenario';
import { rowInput } from 'src/features/draft-changes/__tests__/schema/support/schema-projection-fixture';

describe('draft changes catalogue lifecycle', () => {
  it('pairs a public table rename by stable table identity', async () => {
    const scenario = await givenCatalogueScenario({
      headTableId: 'products',
      draftTableId: 'catalogue',
    });

    const entry = (await buildCatalogue(scenario)).entries.find(
      ({ kind }) => kind === 'table',
    );

    expect(entry).toMatchObject({
      classification: 'renamed',
      target: { tableCreatedId: scenario.tableCreatedId, tableId: 'catalogue' },
    });
  });

  it('represents one-sided table creation separately from its row lifecycle', async () => {
    const scenario = await givenCatalogueScenario();
    const draftOnlyTable = withoutDataTable(scenario, 'head');

    const entries = (await buildCatalogue(draftOnlyTable)).entries;

    expect(
      entries.some(
        ({ kind, classification }) =>
          kind === 'table' && classification === 'created',
      ),
    ).toBe(true);
    expect(
      entries.some(
        ({ kind, classification }) =>
          kind === 'row' && classification === 'created',
      ),
    ).toBe(true);
  });

  it('represents one-sided table deletion separately from its row lifecycle', async () => {
    const scenario = await givenCatalogueScenario();
    const headOnlyTable = withoutDataTable(scenario, 'draft');

    const entries = (await buildCatalogue(headOnlyTable)).entries;

    expect(
      entries.some(
        ({ kind, classification }) =>
          kind === 'table' && classification === 'deleted',
      ),
    ).toBe(true);
    expect(
      entries.some(
        ({ kind, classification }) =>
          kind === 'row' && classification === 'deleted',
      ),
    ).toBe(true);
  });

  it('keeps row creation and deletion atomic instead of emitting child fields', async () => {
    const scenario = await givenCatalogueScenario({
      headRows: [rowInput('existing-row', { title: 'same', price: 1 })],
      draftRows: [
        rowInput('existing-row', { title: 'same', price: 1 }),
        rowInput('created-row', { title: 'new', price: 2 }),
      ],
    });

    const entries = (await buildCatalogue(scenario)).entries;
    const createdRow = entries.find(
      ({ kind, classification }) =>
        kind === 'row' && classification === 'created',
    );

    expect(createdRow?.selectable).toBe(true);
    expect(
      entries.some(
        ({ kind, target }) =>
          kind === 'rowField' &&
          target.kind === 'rowField' &&
          target.rowCreatedId === 'created-row',
      ),
    ).toBe(false);
  });

  it('represents row deletion as one atomic entry without child fields', async () => {
    const scenario = await givenCatalogueScenario({
      headRows: [
        rowInput('existing-row', { title: 'same', price: 1 }),
        rowInput('deleted-row', { title: 'removed', price: 2 }),
      ],
      draftRows: [rowInput('existing-row', { title: 'same', price: 1 })],
    });

    const entries = (await buildCatalogue(scenario)).entries;

    expect(
      entries.some(
        ({ kind, classification, target }) =>
          kind === 'row' &&
          classification === 'deleted' &&
          target.kind === 'row' &&
          target.rowCreatedId === 'deleted-row',
      ),
    ).toBe(true);
    expect(
      entries.some(
        ({ kind, target }) =>
          kind === 'rowField' &&
          target.kind === 'rowField' &&
          target.rowCreatedId === 'deleted-row',
      ),
    ).toBe(false);
  });

  it('pairs row ID swaps by stable identity without cross-matching values', async () => {
    const scenario = await givenCatalogueScenario({
      headRows: [
        rowInput('row-a', { title: 'A', price: 1 }),
        rowInput('row-b', { title: 'B', price: 2 }),
      ],
      draftRows: [
        rowInput('row-a', { title: 'A', price: 1 }),
        rowInput('row-b', { title: 'B', price: 2 }),
      ],
      headRowIds: { 'row-a': 'first', 'row-b': 'second' },
      draftRowIds: { 'row-a': 'second', 'row-b': 'first' },
    });

    const entries = (await buildCatalogue(scenario)).entries.filter(
      ({ kind }) => kind === 'row',
    );

    expect(entries).toHaveLength(2);
    expect(
      entries
        .map(({ target }) => target.kind === 'row' && target.rowCreatedId)
        .sort(),
    ).toEqual(['row-a', 'row-b']);
    expect(
      entries.every(({ classification }) => classification === 'renamed'),
    ).toBe(true);
  });

  it('keeps delete-and-recreate with a reused row ID as separate identities', async () => {
    const scenario = await givenCatalogueScenario({
      headRows: [rowInput('old-row', { title: 'old', price: 1 })],
      draftRows: [rowInput('new-row', { title: 'new', price: 2 })],
      headRowIds: { 'old-row': 'reused-id' },
      draftRowIds: { 'new-row': 'reused-id' },
    });

    const rows = (await buildCatalogue(scenario)).entries.filter(
      ({ kind }) => kind === 'row',
    );

    expect(rows).toHaveLength(2);
    expect(rows.map(({ classification }) => classification).sort()).toEqual([
      'created',
      'deleted',
    ]);
    expect(
      rows
        .map(({ target }) => target.kind === 'row' && target.rowCreatedId)
        .sort(),
    ).toEqual(['new-row', 'old-row']);
  });
});
