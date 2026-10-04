import {
  changeEntry,
  ref,
  resolveSelection,
  selectionCatalogue,
} from './support/selection-fixture';

const rowTarget = {
  kind: 'rowField' as const,
  tableCreatedId: 'table-created',
  rowCreatedId: 'row-created',
  tableId: 'products',
  rowId: 'product-1',
};

describe('draft changes include and exclude selectors', () => {
  it('unions include selectors independent of order and removes duplicate refs', async () => {
    const first = changeEntry(
      'rowField',
      'first',
      { ...rowTarget, path: '/title' },
      { path: '/title' },
    );
    const second = changeEntry(
      'rowField',
      'second',
      { ...rowTarget, path: '/price' },
      { path: '/price' },
    );
    const catalogue = selectionCatalogue({ entries: [first, second] });

    const forward = await resolveSelection(catalogue, {
      include: [
        { kind: 'change', ref: ref('first') },
        { kind: 'change', ref: ref('second') },
        { kind: 'change', ref: ref('first') },
      ],
    });
    const reverse = await resolveSelection(catalogue, {
      include: [
        { kind: 'change', ref: ref('second') },
        { kind: 'change', ref: ref('first') },
      ],
    });

    expect(forward).toMatchObject({
      status: 'resolved',
      selected: [{ ref: ref('first') }, { ref: ref('second') }],
    });
    expect(reverse).toMatchObject({
      status: 'resolved',
      selected: [{ ref: ref('first') }, { ref: ref('second') }],
    });
  });

  it('retains an exclusion for a known unchanged field even without a change entry', async () => {
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
    });

    const result = await resolveSelection(catalogue, {
      include: [{ kind: 'all' }],
      exclude: [
        {
          kind: 'rowFields',
          tableId: 'products',
          rowId: 'product-1',
          paths: ['/unchanged'],
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'resolved',
      excluded: [],
      deniedTargets: [
        {
          kind: 'rowField',
          tableCreatedId: 'table-created',
          rowCreatedId: 'row-created',
          path: '/unchanged',
        },
      ],
    });
  });

  it('keeps include and exclude resolution independent of selector order', async () => {
    const entries = [
      changeEntry(
        'rowField',
        'title',
        { ...rowTarget, path: '/title' },
        { path: '/title' },
      ),
      changeEntry(
        'rowField',
        'price',
        { ...rowTarget, path: '/price' },
        { path: '/price' },
      ),
      changeEntry(
        'rowField',
        'note',
        { ...rowTarget, path: '/note' },
        { path: '/note' },
      ),
    ];
    const catalogue = selectionCatalogue({ entries });
    const selectors = {
      include: [
        { kind: 'change' as const, ref: ref('title') },
        { kind: 'change' as const, ref: ref('price') },
      ],
      exclude: [{ kind: 'change' as const, ref: ref('price') }],
    };

    const forward = await resolveSelection(catalogue, selectors);
    const reverse = await resolveSelection(catalogue, {
      include: [...selectors.include].reverse(),
      exclude: [...selectors.exclude].reverse(),
    });

    expect(forward).toMatchObject({
      status: 'resolved',
      selected: [{ ref: ref('title') }],
      excluded: [{ ref: ref('price') }],
      deniedTargets: [
        {
          kind: 'change',
          ref: ref('price'),
          target: {
            kind: 'rowField',
            rowCreatedId: 'row-created',
            path: '/price',
          },
        },
      ],
    });
    expect(reverse).toEqual(forward);
  });

  it('resolves escaped JSON Pointer paths in a field selector', async () => {
    const escaped = changeEntry(
      'rowField',
      'escaped-ref',
      { ...rowTarget, path: '/a~1b~0c' },
      { path: '/a~1b~0c' },
    );

    const result = await resolveSelection(
      selectionCatalogue({ entries: [escaped] }),
      {
        include: [
          {
            kind: 'rowFields',
            tableId: 'products',
            rowId: 'product-1',
            paths: ['/a~1b~0c'],
          },
        ],
      },
    );

    expect(result).toMatchObject({
      status: 'resolved',
      selected: [{ ref: ref('escaped-ref') }],
    });
  });

  it('resolves schema field paths independently from row field paths', async () => {
    const schema = changeEntry(
      'schemaField',
      'schema-label',
      {
        kind: 'schemaField',
        tableCreatedId: 'table-created',
        tableId: 'products',
        path: '/properties/label',
      },
      { path: '/properties/label', classification: 'renamed' },
    );

    const result = await resolveSelection(
      selectionCatalogue({ entries: [schema] }),
      {
        include: [
          {
            kind: 'schemaFields',
            tableId: 'products',
            paths: ['/properties/label'],
          },
        ],
      },
    );

    expect(result).toMatchObject({
      status: 'resolved',
      selected: [{ ref: ref('schema-label'), kind: 'schemaField' }],
    });
  });
});
