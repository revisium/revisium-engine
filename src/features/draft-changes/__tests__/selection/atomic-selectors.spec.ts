import {
  atomicPathSelection,
  changeEntry,
  resolveSelection,
  selectionCatalogue,
} from './support/selection-fixture';
import {
  buildCatalogue,
  givenCatalogueScenario,
  withoutDataTable,
} from 'src/features/draft-changes/__tests__/catalogue/support/catalogue-scenario';

const rowTarget = {
  kind: 'rowField' as const,
  tableCreatedId: 'table-created',
  rowCreatedId: 'row-created',
  tableId: 'products',
  rowId: 'product-1',
};

describe('draft changes atomic field selectors', () => {
  it.each([
    {
      classification: 'created' as const,
      roles: { headIds: [], draftIds: ['product-1'] },
    },
    {
      classification: 'deleted' as const,
      roles: { headIds: ['product-1'], draftIds: [] },
    },
  ])(
    'blocks a nonempty field selection on a $classification row lifecycle entry',
    async ({ classification, roles }) => {
      const rowEntry = changeEntry(
        'row',
        `lifecycle-${classification}`,
        {
          kind: 'row',
          tableCreatedId: 'table-created',
          rowCreatedId: 'row-created',
          tableId: 'products',
          rowId: 'product-1',
        },
        { classification, path: '' },
      );
      const catalogue = selectionCatalogue({
        entries: [rowEntry],
        identityBindings: [
          {
            kind: 'row',
            tableCreatedId: 'table-created',
            entityCreatedId: 'row-created',
            ...roles,
          },
        ],
      });

      const result = await resolveSelection(catalogue, {
        include: [
          {
            kind: 'rowFields',
            tableId: 'products',
            rowId: 'product-1',
            paths: ['/title'],
          },
        ],
      });

      expect(result).toMatchObject({
        status: 'blocked',
        blockers: [{ code: 'ATOMIC_DESCENDANT' }],
      });
    },
  );

  it.each(['include', 'exclude'] as const)(
    'blocks nonempty field selection on a lifecycle row during %s',
    async (direction) => {
      const rowEntry = changeEntry(
        'row',
        'lifecycle-created',
        {
          kind: 'row',
          tableCreatedId: 'table-created',
          rowCreatedId: 'row-created',
          tableId: 'products',
          rowId: 'product-1',
        },
        { classification: 'created', path: '' },
      );
      const catalogue = selectionCatalogue({ entries: [rowEntry] });
      const choice = {
        kind: 'rowFields' as const,
        tableId: 'products',
        rowId: 'product-1',
        paths: ['/title'],
      };

      const result = await resolveSelection(
        catalogue,
        atomicPathSelection(choice, direction),
      );

      expect(result).toMatchObject({
        status: 'blocked',
        blockers: [{ code: 'ATOMIC_DESCENDANT' }],
      });
    },
  );

  it.each([
    { classification: 'created' as const, path: undefined },
    { classification: 'created' as const, path: 'all' as const },
    { classification: 'deleted' as const, path: undefined },
    { classification: 'deleted' as const, path: 'all' as const },
  ])(
    'blocks default or all field selection on a $classification row',
    async ({ classification, path }) => {
      const rowEntry = changeEntry(
        'row',
        `lifecycle-${classification}`,
        {
          kind: 'row',
          tableCreatedId: 'table-created',
          rowCreatedId: 'row-created',
          tableId: 'products',
          rowId: 'product-1',
        },
        { classification, path: '' },
      );
      const catalogue = selectionCatalogue({ entries: [rowEntry] });
      const choice = {
        kind: 'rowFields' as const,
        tableId: 'products',
        rowId: 'product-1',
        ...(path === undefined ? {} : { paths: path }),
      };

      const result = await resolveSelection(catalogue, { include: [choice] });

      expect(result).toMatchObject({
        status: 'blocked',
        blockers: [{ code: 'ATOMIC_DESCENDANT' }],
      });
    },
  );

  it('blocks a field selector for a row created in a one-sided table', async () => {
    const scenario = await givenCatalogueScenario({
      headRows: [],
      draftRows: [{ createdId: 'new-row', data: { title: 'Draft' } }],
    });
    const input = withoutDataTable(scenario, 'head');
    const catalogue = await buildCatalogue(input);

    const result = await resolveSelection(catalogue, {
      include: [
        {
          kind: 'rowFields',
          tableId: 'products',
          rowId: 'new-row',
          paths: ['/title'],
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'ATOMIC_DESCENDANT' }],
    });
  });

  it.each(['include', 'exclude'] as const)(
    'blocks an explicit array descendant in %s selectors',
    async (direction) => {
      const arrayEntry = changeEntry(
        'rowField',
        'array-ref',
        { ...rowTarget, path: '/items' },
        { path: '/items', classification: 'atomic' },
      );
      const catalogue = selectionCatalogue({ entries: [arrayEntry] });
      const choice = {
        kind: 'rowFields' as const,
        tableId: 'products',
        rowId: 'product-1',
        paths: ['/items/0/value'],
      };

      const result = await resolveSelection(
        catalogue,
        atomicPathSelection(choice, direction),
      );

      expect(result).toMatchObject({
        status: 'blocked',
        blockers: [{ code: 'ATOMIC_DESCENDANT' }],
      });
    },
  );

  it.each(['include', 'exclude'] as const)(
    'blocks an explicit file child in %s selectors',
    async (direction) => {
      const fileEntry = changeEntry(
        'rowField',
        'file-ref',
        { ...rowTarget, path: '/photo' },
        { path: '/photo', classification: 'atomic' },
      );
      const catalogue = selectionCatalogue({ entries: [fileEntry] });
      const choice = {
        kind: 'rowFields' as const,
        tableId: 'products',
        rowId: 'product-1',
        paths: ['/photo/url'],
      };

      const result = await resolveSelection(
        catalogue,
        atomicPathSelection(choice, direction),
      );

      expect(result).toMatchObject({
        status: 'blocked',
        blockers: [{ code: 'ATOMIC_DESCENDANT' }],
      });
    },
  );

  it.each([
    {
      kind: 'array' as const,
      path: '/items',
      child: '/items/0/value',
      direction: 'include' as const,
    },
    {
      kind: 'array' as const,
      path: '/items',
      child: '/items/0/value',
      direction: 'exclude' as const,
    },
    {
      kind: 'file' as const,
      path: '/photo',
      child: '/photo/url',
      direction: 'include' as const,
    },
    {
      kind: 'file' as const,
      path: '/photo',
      child: '/photo/url',
      direction: 'exclude' as const,
    },
  ])(
    'blocks a descendant of an unchanged $kind field in $direction selectors',
    async ({ kind, path, child, direction }) => {
      const catalogue = selectionCatalogue({
        identityBindings: [
          {
            kind: 'row',
            tableCreatedId: 'table-created',
            entityCreatedId: 'row-created',
            headIds: ['product-1'],
            draftIds: ['product-1'],
          },
        ],
        fieldBoundaries: [{ tableCreatedId: 'table-created', kind, path }],
      });
      const choice = {
        kind: 'rowFields' as const,
        tableId: 'products',
        rowId: 'product-1',
        paths: [child],
      };

      const result = await resolveSelection(
        catalogue,
        atomicPathSelection(choice, direction),
      );

      expect(result).toMatchObject({
        status: 'blocked',
        blockers: [{ code: 'ATOMIC_DESCENDANT' }],
      });
    },
  );
});
