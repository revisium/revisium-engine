import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import { pluginRefs } from '@revisium/schema-toolkit/lib';
import {
  buildCatalogue,
  CATALOGUE_ROW_CREATED_ID,
  givenCatalogueScenario,
} from './support/catalogue-scenario';
import {
  arraySchema,
  numberField,
  objectSchema,
  rowInput,
} from 'src/features/draft-changes/__tests__/schema/support/schema-projection-fixture';
import { buildRowFieldEntries } from 'src/features/draft-changes/catalogue/row-fields';
import { RowDiffService } from 'src/features/revision-changes/services/row-diff.service';

describe('draft changes catalogue field boundaries', () => {
  it('uses an empty JSON Pointer for a root-value change', async () => {
    const scenario = await givenCatalogueScenario({
      headRows: [rowInput(CATALOGUE_ROW_CREATED_ID, 10)],
      draftRows: [rowInput(CATALOGUE_ROW_CREATED_ID, '10')],
    });

    const entry = (await buildCatalogue(scenario)).entries.find(
      ({ kind }) => kind === 'rowField',
    );

    expect(entry).toMatchObject({ path: '', before: 10, after: '10' });
  });

  it('treats a root array as the outermost atomic boundary', async () => {
    const scenario = await givenCatalogueScenario({
      headRows: [rowInput(CATALOGUE_ROW_CREATED_ID, [{ price: 10 }])],
      draftRows: [rowInput(CATALOGUE_ROW_CREATED_ID, [{ price: 11 }])],
    });

    const entry = (await buildCatalogue(scenario)).entries.find(
      ({ kind }) => kind === 'rowField',
    );

    expect(entry).toMatchObject({ path: '', classification: 'atomic' });
  });

  it('escapes slash and tilde in supplied Draft paths as JSON Pointer segments', async () => {
    const scenario = await givenCatalogueScenario({
      headRows: [rowInput(CATALOGUE_ROW_CREATED_ID, { title: 'same' })],
      draftRows: [
        rowInput(CATALOGUE_ROW_CREATED_ID, { title: 'same', 'a/b~c': 'new' }),
      ],
    });

    const entry = (await buildCatalogue(scenario)).entries.find(
      ({ kind }) => kind === 'rowField',
    );

    expect(entry?.path).toBe('/a~1b~0c');
  });

  it('collapses nested array changes to the outermost array boundary', async () => {
    const schema = objectSchema({
      entries: arraySchema(
        objectSchema({ prices: arraySchema(numberField()) }),
      ),
    });
    const scenario = await givenCatalogueScenario({
      headSchema: schema,
      draftSchema: schema,
      headRows: [
        rowInput(CATALOGUE_ROW_CREATED_ID, { entries: [{ prices: [10] }] }),
      ],
      draftRows: [
        rowInput(CATALOGUE_ROW_CREATED_ID, { entries: [{ prices: [11] }] }),
      ],
    });

    const entry = (await buildCatalogue(scenario)).entries.find(
      ({ kind }) => kind === 'rowField',
    );

    expect(entry).toMatchObject({
      kind: 'rowField',
      path: '/entries',
      classification: 'atomic',
    });
  });

  it('represents a file reference change as one atomic file-field entry', async () => {
    const schema = objectSchema({ photo: { $ref: SystemSchemaIds.File } });
    const scenario = await givenCatalogueScenario({
      headSchema: schema,
      draftSchema: schema,
      headRows: [
        rowInput(CATALOGUE_ROW_CREATED_ID, {
          photo: { fileId: 'file-1', fileName: 'before.png', url: '/before' },
        }),
      ],
      draftRows: [
        rowInput(CATALOGUE_ROW_CREATED_ID, {
          photo: { fileId: 'file-1', fileName: 'after.png', url: '/after' },
        }),
      ],
    });

    const entries = (await buildCatalogue(scenario)).entries.filter(
      ({ kind }) => kind === 'rowField',
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      path: '/photo',
      classification: 'atomic',
    });
  });

  it('records unchanged array and file boundaries from the supplied schema', async () => {
    const schema = objectSchema({
      entries: arraySchema(numberField()),
      photo: { $ref: SystemSchemaIds.File },
    });
    const scenario = await givenCatalogueScenario({
      headSchema: schema,
      draftSchema: schema,
      headRows: [
        rowInput(CATALOGUE_ROW_CREATED_ID, { entries: [1], photo: null }),
      ],
      draftRows: [
        rowInput(CATALOGUE_ROW_CREATED_ID, { entries: [1], photo: null }),
      ],
    });

    expect((await buildCatalogue(scenario)).fieldBoundaries).toEqual(
      expect.arrayContaining([
        {
          tableCreatedId: scenario.tableCreatedId,
          kind: 'array',
          path: '/entries',
        },
        {
          tableCreatedId: scenario.tableCreatedId,
          kind: 'file',
          path: '/photo',
        },
      ]),
    );
  });

  it('records unchanged formula fields for explicit-selection blocking', async () => {
    const schema = objectSchema({
      total: {
        type: 'number',
        default: 0,
        readOnly: true,
        'x-formula': { version: 1, expression: '1 + 1' },
      },
    });
    const scenario = await givenCatalogueScenario({
      headSchema: schema,
      draftSchema: schema,
      headRows: [rowInput(CATALOGUE_ROW_CREATED_ID, { total: 2 })],
      draftRows: [rowInput(CATALOGUE_ROW_CREATED_ID, { total: 2 })],
    });

    expect((await buildCatalogue(scenario)).fieldBoundaries).toContainEqual({
      tableCreatedId: scenario.tableCreatedId,
      kind: 'computed',
      path: '/total',
    });
  });

  it('marks changed read-only row metadata from plugin refs as computed', async () => {
    const readOnlyRef = requiredReadOnlyPluginRef();
    const schema = objectSchema({ metadata: { $ref: readOnlyRef } });
    const scenario = await givenCatalogueScenario({
      headSchema: schema,
      draftSchema: schema,
      headRows: [rowInput(CATALOGUE_ROW_CREATED_ID, { metadata: 'head' })],
      draftRows: [rowInput(CATALOGUE_ROW_CREATED_ID, { metadata: 'draft' })],
    });

    expect((await buildCatalogue(scenario)).entries).toContainEqual(
      expect.objectContaining({
        path: '/metadata',
        classification: 'computed',
        selectable: false,
      }),
    );
  });

  it('marks changed formula outputs informational and nonselectable', async () => {
    const schema = objectSchema({
      price: numberField(),
      total: {
        type: 'number',
        default: 0,
        readOnly: true,
        'x-formula': { version: 1, expression: 'price * 2' },
      },
    });
    const scenario = await givenCatalogueScenario({
      headSchema: schema,
      draftSchema: schema,
      headRows: [rowInput(CATALOGUE_ROW_CREATED_ID, { price: 1, total: 2 })],
      draftRows: [rowInput(CATALOGUE_ROW_CREATED_ID, { price: 1, total: 3 })],
    });

    const entry = (await buildCatalogue(scenario)).entries.find(
      ({ path }) => path === '/total',
    );

    expect(entry).toMatchObject({
      classification: 'computed',
      selectable: false,
    });
  });

  it('marks formula-only changes inside arrays informational instead of selectable', async () => {
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
    const scenario = await givenCatalogueScenario({
      headSchema: schema,
      draftSchema: schema,
      headRows: [
        rowInput(CATALOGUE_ROW_CREATED_ID, { items: [{ input: 1, total: 2 }] }),
      ],
      draftRows: [
        rowInput(CATALOGUE_ROW_CREATED_ID, { items: [{ input: 1, total: 3 }] }),
      ],
    });

    const entry = (await buildCatalogue(scenario)).entries.find(
      ({ kind }) => kind === 'rowField',
    );

    expect(entry).toMatchObject({
      path: '/items',
      classification: 'computed',
      selectable: false,
    });
  });

  it('keeps a mixed editable and formula array change as one selectable atomic entry', async () => {
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
    const scenario = await givenCatalogueScenario({
      headSchema: schema,
      draftSchema: schema,
      headRows: [
        rowInput(CATALOGUE_ROW_CREATED_ID, { items: [{ input: 1, total: 2 }] }),
      ],
      draftRows: [
        rowInput(CATALOGUE_ROW_CREATED_ID, { items: [{ input: 2, total: 4 }] }),
      ],
    });

    const entry = (await buildCatalogue(scenario)).entries.find(
      ({ kind }) => kind === 'rowField',
    );

    expect(entry).toMatchObject({
      path: '/items',
      classification: 'atomic',
      selectable: true,
    });
  });

  it('classifies a computed root array as informational before atomic collapsing', async () => {
    const beforeData = [{ value: 1 }];
    const afterData = [{ value: 2 }];
    const result = buildRowFieldEntries({
      identity: {
        tableCreatedId: 'stable-products',
        rowCreatedId: CATALOGUE_ROW_CREATED_ID,
        tableId: 'products',
        rowId: CATALOGUE_ROW_CREATED_ID,
      },
      beforeData,
      afterData,
      changes: new RowDiffService().analyzeFieldChanges(beforeData, afterData),
      boundaries: [
        { tableCreatedId: 'stable-products', kind: 'computed', path: '' },
      ],
    });
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '',
          classification: 'computed',
          selectable: false,
        }),
      ]),
    );
  });

  it('classifies a scalar root formula value as informational', async () => {
    const beforeData = 2;
    const afterData = 3;
    const result = buildRowFieldEntries({
      identity: {
        tableCreatedId: 'stable-products',
        rowCreatedId: CATALOGUE_ROW_CREATED_ID,
        tableId: 'products',
        rowId: CATALOGUE_ROW_CREATED_ID,
      },
      beforeData,
      afterData,
      changes: new RowDiffService().analyzeFieldChanges(beforeData, afterData),
      boundaries: [
        { tableCreatedId: 'stable-products', kind: 'computed', path: '' },
      ],
    });

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '',
          classification: 'computed',
          selectable: false,
        }),
      ]),
    );
  });
});

function requiredReadOnlyPluginRef(): string {
  const ref = Object.entries(pluginRefs).find(
    ([candidate, schema]) =>
      candidate !== SystemSchemaIds.File &&
      'readOnly' in schema &&
      schema.readOnly === true,
  )?.[0];
  if (!ref) {
    throw new Error('The toolkit must expose a read-only row metadata ref.');
  }
  return ref;
}
