import {
  changeEntry,
  ref,
  resolveSelection,
  selectionCatalogue,
} from './support/selection-fixture';
import {
  buildCatalogue,
  givenCatalogueScenario,
  CATALOGUE_ROW_CREATED_ID,
} from 'src/features/draft-changes/__tests__/catalogue/support/catalogue-scenario';
import {
  arraySchema,
  numberField,
  objectSchema,
  rowInput,
} from 'src/features/draft-changes/__tests__/schema/support/schema-projection-fixture';

const rowTarget = {
  kind: 'rowField' as const,
  tableCreatedId: 'table-created',
  rowCreatedId: 'row-created',
  tableId: 'products',
  rowId: 'product-1',
};

describe('draft changes computed field selectors', () => {
  it('blocks an explicit unchanged computed field', async () => {
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
      fieldBoundaries: [
        { tableCreatedId: 'table-created', kind: 'computed', path: '/total' },
      ],
    });

    const included = await resolveSelection(catalogue, {
      include: [
        {
          kind: 'rowFields',
          tableId: 'products',
          rowId: 'product-1',
          paths: ['/total'],
        },
      ],
    });
    expect(included).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'NON_SELECTABLE' }],
    });
  });

  it('allows schema-root selection when the schema has computed row values', async () => {
    const schemaEntry = changeEntry(
      'schemaField',
      'schema-root',
      {
        kind: 'schemaField',
        tableCreatedId: 'table-created',
        tableId: 'products',
        path: '',
      },
      { path: '' },
    );
    const catalogue = selectionCatalogue({
      entries: [schemaEntry],
      fieldBoundaries: [
        { tableCreatedId: 'table-created', kind: 'computed', path: '/total' },
      ],
    });

    const result = await resolveSelection(catalogue, {
      include: [{ kind: 'schemaFields', tableId: 'products', paths: [''] }],
    });

    expect(result).toMatchObject({
      status: 'resolved',
      selected: [{ ref: ref('schema-root') }],
    });
  });

  it('allows formula-definition schema effects on a computed row field', async () => {
    const formulaEntry = changeEntry(
      'schemaField',
      'formula-definition',
      {
        kind: 'schemaField',
        tableCreatedId: 'table-created',
        tableId: 'products',
        path: '/properties/total/x-formula/expression',
      },
      { path: '/properties/total/x-formula/expression' },
    );
    const catalogue = selectionCatalogue({
      entries: [formulaEntry],
      fieldBoundaries: [
        { tableCreatedId: 'table-created', kind: 'computed', path: '/total' },
      ],
    });

    const result = await resolveSelection(catalogue, {
      include: [
        {
          kind: 'schemaFields',
          tableId: 'products',
          paths: ['/properties/total/x-formula/expression'],
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'resolved',
      selected: [{ ref: ref('formula-definition') }],
    });
  });

  it('omits unchanged computed fields from broad inclusion', async () => {
    const catalogue = selectionCatalogue({
      fieldBoundaries: [
        { tableCreatedId: 'table-created', kind: 'computed', path: '/total' },
      ],
    });
    const broad = await resolveSelection(catalogue, {
      include: [{ kind: 'all' }],
    });

    expect(broad).toMatchObject({ status: 'resolved', selected: [] });
  });

  it('omits computed values from broad inclusion', async () => {
    const editable = changeEntry(
      'rowField',
      'editable',
      { ...rowTarget, path: '/price' },
      { path: '/price' },
    );
    const computed = changeEntry(
      'rowField',
      'computed',
      { ...rowTarget, path: '/total' },
      { path: '/total', classification: 'computed', selectable: false },
    );

    const result = await resolveSelection(
      selectionCatalogue({ entries: [editable, computed] }),
      { include: [{ kind: 'all' }] },
    );

    expect(result).toMatchObject({
      status: 'resolved',
      selected: [{ ref: ref('editable') }],
    });
  });

  it('blocks an explicit computed field selection', async () => {
    const computed = changeEntry(
      'rowField',
      'computed',
      { ...rowTarget, path: '/total' },
      { path: '/total', classification: 'computed', selectable: false },
    );

    const result = await resolveSelection(
      selectionCatalogue({ entries: [computed] }),
      { include: [{ kind: 'change', ref: ref('computed') }] },
    );

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'NON_SELECTABLE' }],
    });
  });

  it('allows selecting a mixed editable and computed array as one atomic value', async () => {
    const schema = objectSchema({
      items: arraySchema(
        objectSchema({
          input: numberField(),
          total: {
            type: 'number',
            default: 0,
            readOnly: true,
            'x-formula': { version: 1, expression: 'input * 2' },
          },
        }),
      ),
    });
    const catalogue = await buildCatalogue(
      await givenCatalogueScenario({
        headSchema: schema,
        draftSchema: schema,
        headRows: [
          rowInput(CATALOGUE_ROW_CREATED_ID, {
            items: [{ input: 1, total: 2 }],
          }),
        ],
        draftRows: [
          rowInput(CATALOGUE_ROW_CREATED_ID, {
            items: [{ input: 2, total: 4 }],
          }),
        ],
      }),
    );

    const result = await resolveSelection(catalogue, {
      include: [
        {
          kind: 'rowFields',
          tableId: 'products',
          rowId: CATALOGUE_ROW_CREATED_ID,
          paths: ['/items'],
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'resolved',
      selected: [expect.objectContaining({ kind: 'rowField', path: '/items' })],
    });
  });

  it('blocks selecting a computed-only array as one value', async () => {
    const schema = objectSchema({
      items: arraySchema(
        objectSchema({
          input: numberField(),
          total: {
            type: 'number',
            default: 0,
            readOnly: true,
            'x-formula': { version: 1, expression: 'input * 2' },
          },
        }),
      ),
    });
    const catalogue = await buildCatalogue(
      await givenCatalogueScenario({
        headSchema: schema,
        draftSchema: schema,
        headRows: [
          rowInput(CATALOGUE_ROW_CREATED_ID, {
            items: [{ input: 1, total: 2 }],
          }),
        ],
        draftRows: [
          rowInput(CATALOGUE_ROW_CREATED_ID, {
            items: [{ input: 1, total: 3 }],
          }),
        ],
      }),
    );

    const result = await resolveSelection(catalogue, {
      include: [
        {
          kind: 'rowFields',
          tableId: 'products',
          rowId: CATALOGUE_ROW_CREATED_ID,
          paths: ['/items'],
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'NON_SELECTABLE' }],
    });
  });

  it('does not let a selectable array authorize another computed include path', async () => {
    const catalogue = await mixedArrayAndUnchangedComputedCatalogue();
    const result = await resolveSelection(catalogue, {
      include: [
        {
          kind: 'rowFields',
          tableId: 'products',
          rowId: CATALOGUE_ROW_CREATED_ID,
          paths: ['/items', '/total'],
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'NON_SELECTABLE' }],
    });
  });

  it('does not let a selectable array authorize another computed exclude path', async () => {
    const catalogue = await mixedArrayAndUnchangedComputedCatalogue();
    const result = await resolveSelection(catalogue, {
      include: [{ kind: 'all' }],
      exclude: [
        {
          kind: 'rowFields',
          tableId: 'products',
          rowId: CATALOGUE_ROW_CREATED_ID,
          paths: ['/items', '/total'],
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'NON_SELECTABLE' }],
    });
  });
});

async function mixedArrayAndUnchangedComputedCatalogue() {
  const schema = objectSchema({
    items: arraySchema(
      objectSchema({
        input: numberField(),
        total: {
          type: 'number',
          default: 0,
          readOnly: true,
          'x-formula': { version: 1, expression: 'input * 2' },
        },
      }),
    ),
    total: {
      type: 'number',
      default: 0,
      readOnly: true,
      'x-formula': { version: 1, expression: '1' },
    },
  });
  return buildCatalogue(
    await givenCatalogueScenario({
      headSchema: schema,
      draftSchema: schema,
      headRows: [
        rowInput(CATALOGUE_ROW_CREATED_ID, {
          items: [{ input: 1, total: 2 }],
          total: 1,
        }),
      ],
      draftRows: [
        rowInput(CATALOGUE_ROW_CREATED_ID, {
          items: [{ input: 2, total: 4 }],
          total: 1,
        }),
      ],
    }),
  );
}
