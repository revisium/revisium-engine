import {
  changeEntry,
  ref,
  resolveSelection,
  selectionCatalogue,
} from './support/selection-fixture';

describe('draft changes entity selectors', () => {
  it('includes table rows by default', async () => {
    const entries = [
      changeEntry('table', 'table-ref', {
        kind: 'table',
        tableCreatedId: 'table-created',
        tableId: 'products',
      }),
      changeEntry('row', 'row-ref', {
        kind: 'row',
        tableCreatedId: 'table-created',
        rowCreatedId: 'row-created',
        tableId: 'products',
        rowId: 'product-1',
      }),
      changeEntry('schemaField', 'schema-ref', {
        kind: 'schemaField',
        tableCreatedId: 'table-created',
        tableId: 'products',
        path: '/properties/price',
      }),
    ];

    const result = await resolveSelection(selectionCatalogue({ entries }), {
      include: [{ kind: 'table', tableId: 'products' }],
    });

    expect(result).toMatchObject({
      status: 'resolved',
      selected: [
        { ref: ref('table-ref') },
        { ref: ref('row-ref') },
        { ref: ref('schema-ref') },
      ],
    });
  });

  it('keeps table and schema effects when rows are explicitly excluded', async () => {
    const table = changeEntry('table', 'table-ref', {
      kind: 'table',
      tableCreatedId: 'table-created',
      tableId: 'products',
    });
    const row = changeEntry('row', 'row-ref', {
      kind: 'row',
      tableCreatedId: 'table-created',
      rowCreatedId: 'row-created',
      tableId: 'products',
      rowId: 'product-1',
    });
    const field = changeEntry('rowField', 'field-ref', {
      kind: 'rowField',
      tableCreatedId: 'table-created',
      rowCreatedId: 'row-created',
      tableId: 'products',
      rowId: 'product-1',
      path: '/properties/price',
    });
    const schema = changeEntry('schemaField', 'schema-ref', {
      kind: 'schemaField',
      tableCreatedId: 'table-created',
      tableId: 'products',
      path: '/price',
    });
    const catalogue = selectionCatalogue({
      entries: [table, row, field, schema],
    });

    const result = await resolveSelection(catalogue, {
      include: [{ kind: 'table', tableId: 'products', rows: 'none' }],
    });

    expect(result).toMatchObject({
      status: 'resolved',
      selected: [{ ref: ref('table-ref') }, { ref: ref('schema-ref') }],
    });
  });

  it('blocks a row ID selector when deletion and recreation make that ID ambiguous', async () => {
    const catalogue = selectionCatalogue({
      entries: [
        changeEntry(
          'row',
          'deleted-ref',
          {
            kind: 'row',
            tableCreatedId: 'table-created',
            rowCreatedId: 'old-row',
            tableId: 'products',
            rowId: 'reused-id',
          },
          { classification: 'deleted' },
        ),
        changeEntry(
          'row',
          'created-ref',
          {
            kind: 'row',
            tableCreatedId: 'table-created',
            rowCreatedId: 'new-row',
            tableId: 'products',
            rowId: 'reused-id',
          },
          { classification: 'created' },
        ),
      ],
      identityBindings: [
        {
          kind: 'row',
          tableCreatedId: 'table-created',
          entityCreatedId: 'old-row',
          headIds: ['reused-id'],
          draftIds: [],
        },
        {
          kind: 'row',
          tableCreatedId: 'table-created',
          entityCreatedId: 'new-row',
          headIds: [],
          draftIds: ['reused-id'],
        },
      ],
    });

    const result = await resolveSelection(catalogue, {
      include: [{ kind: 'rows', tableId: 'products', rowIds: ['reused-id'] }],
    });

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'AMBIGUOUS_IDENTITY' }],
    });
  });

  it('uses exact refs to distinguish same-ID lifecycle entries', async () => {
    const deleted = changeEntry(
      'row',
      'deleted-ref',
      {
        kind: 'row',
        tableCreatedId: 'table-created',
        rowCreatedId: 'old-row',
        tableId: 'products',
        rowId: 'reused-id',
      },
      { classification: 'deleted' },
    );
    const created = changeEntry(
      'row',
      'created-ref',
      {
        kind: 'row',
        tableCreatedId: 'table-created',
        rowCreatedId: 'new-row',
        tableId: 'products',
        rowId: 'reused-id',
      },
      { classification: 'created' },
    );

    const result = await resolveSelection(
      selectionCatalogue({ entries: [deleted, created] }),
      { include: [{ kind: 'change', ref: ref('created-ref') }] },
    );

    expect(result).toMatchObject({
      status: 'resolved',
      selected: [
        { ref: ref('created-ref'), target: { rowCreatedId: 'new-row' } },
      ],
    });
  });

  it('resolves a known unchanged row target to an empty selection', async () => {
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
      include: [
        {
          kind: 'rowFields',
          tableId: 'products',
          rowId: 'product-1',
          paths: ['/price'],
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'resolved',
      selected: [],
      excluded: [],
    });
  });

  it('retains row and table denials for unchanged known targets', async () => {
    const catalogue = selectionCatalogue({
      identityBindings: [
        {
          kind: 'table',
          tableCreatedId: 'table-created',
          entityCreatedId: 'table-created',
          headIds: ['products'],
          draftIds: ['products'],
        },
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
        { kind: 'table', tableId: 'products' },
        { kind: 'rows', tableId: 'products', rowIds: ['product-1'] },
      ],
    });

    expect(result).toMatchObject({
      status: 'resolved',
      excluded: [],
      deniedTargets: [
        {
          kind: 'table',
          tableCreatedId: 'table-created',
          facets: ['lifecycle', 'rows', 'schemaFields'],
        },
        {
          kind: 'row',
          tableCreatedId: 'table-created',
          rowCreatedId: 'row-created',
          facets: ['lifecycle', 'rowFields'],
        },
      ],
    });
  });
});
