import {
  buildCatalogue,
  CATALOGUE_ROW_CREATED_ID,
  givenCatalogueScenario,
} from './support/catalogue-scenario';
import {
  addField,
  givenSchemaPatchGroups,
  moveField,
  numberField,
  objectSchema,
  rowInput,
  stringField,
} from 'src/features/draft-changes/__tests__/schema/support/schema-projection-fixture';

describe('draft changes catalogue schema effects', () => {
  it('does not report a user edit for a value produced only by migration defaults', async () => {
    const headSchema = objectSchema({ title: stringField() });
    const draftSchema = objectSchema({
      title: stringField(),
      quantity: numberField(0),
    });
    const scenario = await givenCatalogueScenario({
      headSchema,
      draftSchema,
      pending: [
        {
          patches: [addField('/properties/quantity', numberField(0))],
          schema: draftSchema,
        },
      ],
      headRows: [rowInput(CATALOGUE_ROW_CREATED_ID, { title: 'same' })],
      draftRows: [
        rowInput(CATALOGUE_ROW_CREATED_ID, { title: 'same', quantity: 0 }),
      ],
    });

    const entries = (await buildCatalogue(scenario)).entries;

    expect(entries.some(({ kind }) => kind === 'schemaField')).toBe(true);
    expect(
      entries.some(
        ({ kind, path }) => kind === 'rowField' && path === '/quantity',
      ),
    ).toBe(false);
  });

  it('maps an independent edit through a recorded rename to the terminal path', async () => {
    const headSchema = objectSchema({ title: stringField() });
    const draftSchema = objectSchema({ label: stringField() });
    const scenario = await givenCatalogueScenario({
      headSchema,
      draftSchema,
      pending: [
        {
          patches: [moveField('/properties/title', '/properties/label')],
          schema: draftSchema,
        },
      ],
      headRows: [rowInput(CATALOGUE_ROW_CREATED_ID, { title: 'Head' })],
      draftRows: [rowInput(CATALOGUE_ROW_CREATED_ID, { label: 'Draft edit' })],
    });

    const entries = (await buildCatalogue(scenario)).entries;

    expect(
      entries.find(
        ({ kind, path }) => kind === 'rowField' && path === '/label',
      ),
    ).toMatchObject({
      before: 'Head',
      after: 'Draft edit',
    });
    expect(
      entries.find(
        ({ kind, path }) =>
          kind === 'schemaField' && path === '/properties/label',
      )?.effectRefs,
    ).toEqual([{ historyIndex: 1, patchIndex: 0 }]);
  });

  it('keeps a migration-only rename separate from user data changes', async () => {
    const headSchema = objectSchema({ title: stringField() });
    const draftSchema = objectSchema({ label: stringField() });
    const scenario = await givenCatalogueScenario({
      headSchema,
      draftSchema,
      pending: [
        {
          patches: [moveField('/properties/title', '/properties/label')],
          schema: draftSchema,
        },
      ],
      headRows: [rowInput(CATALOGUE_ROW_CREATED_ID, { title: 'same' })],
      draftRows: [rowInput(CATALOGUE_ROW_CREATED_ID, { label: 'same' })],
    });

    const entries = (await buildCatalogue(scenario)).entries;

    expect(
      entries.some(
        ({ kind, classification }) =>
          kind === 'schemaField' && classification === 'renamed',
      ),
    ).toBe(true);
    expect(entries.some(({ kind }) => kind === 'rowField')).toBe(false);
  });

  it('keeps rename lineage coordinates across separate recorded update groups', async () => {
    const headSchema = objectSchema({ title: stringField() });
    const middleSchema = objectSchema({ name: stringField() });
    const draftSchema = objectSchema({ label: stringField() });
    const scenario = await givenCatalogueScenario({
      headSchema,
      draftSchema,
      pending: [
        {
          patches: [moveField('/properties/title', '/properties/name')],
          schema: middleSchema,
        },
        {
          patches: [moveField('/properties/name', '/properties/label')],
          schema: draftSchema,
        },
      ],
      headRows: [rowInput(CATALOGUE_ROW_CREATED_ID, { title: 'Head' })],
      draftRows: [rowInput(CATALOGUE_ROW_CREATED_ID, { label: 'Head' })],
    });

    const schemaEntry = (await buildCatalogue(scenario)).entries.find(
      ({ kind, path }) =>
        kind === 'schemaField' && path === '/properties/label',
    );

    expect(schemaEntry?.effectRefs).toEqual([
      { historyIndex: 1, patchIndex: 0 },
      { historyIndex: 2, patchIndex: 0 },
    ]);
  });

  it('retains sibling patch positions from the original history group', async () => {
    const headSchema = objectSchema({ title: stringField() });
    const draftSchema = objectSchema({
      label: stringField(),
      quantity: numberField(0),
    });
    const scenario = await givenCatalogueScenario({
      headSchema,
      draftSchema,
      pending: [
        {
          patches: [
            moveField('/properties/title', '/properties/label'),
            addField('/properties/quantity', numberField(0)),
          ],
          schema: draftSchema,
        },
      ],
      headRows: [rowInput(CATALOGUE_ROW_CREATED_ID, { title: 'same' })],
      draftRows: [
        rowInput(CATALOGUE_ROW_CREATED_ID, { label: 'same', quantity: 0 }),
      ],
    });

    const schemaEntries = (await buildCatalogue(scenario)).entries.filter(
      ({ kind }) => kind === 'schemaField',
    );

    expect(schemaEntries.flatMap(({ effectRefs }) => effectRefs ?? [])).toEqual(
      [
        { historyIndex: 1, patchIndex: 0 },
        { historyIndex: 1, patchIndex: 1 },
      ],
    );
  });

  it('does not alias remove-and-readd field identity at the same path', async () => {
    const headSchema = objectSchema({ title: stringField() });
    const removedSchema = objectSchema({});
    const draftSchema = objectSchema({ title: stringField() });
    const scenario = await givenCatalogueScenario({
      headSchema,
      draftSchema,
      pending: [
        {
          patches: [{ op: 'remove', path: '/properties/title' }],
          schema: removedSchema,
        },
        {
          patches: [addField('/properties/title', stringField())],
          schema: draftSchema,
        },
      ],
      headRows: [rowInput(CATALOGUE_ROW_CREATED_ID, { title: 'Head' })],
      draftRows: [rowInput(CATALOGUE_ROW_CREATED_ID, { title: 'new' })],
    });

    const entries = (await buildCatalogue(scenario)).entries.filter(
      ({ kind, path }) =>
        kind === 'schemaField' && path === '/properties/title',
    );

    expect(entries).toHaveLength(2);
    expect(entries[0]?.ref).not.toEqual(entries[1]?.ref);
    expect(entries[0]).toMatchObject({
      classification: 'deleted',
      before: expect.any(Object),
      beforeExists: true,
      afterExists: false,
      effectRefs: [{ historyIndex: 1, patchIndex: 0 }],
    });
    expect(entries[1]).toMatchObject({
      classification: 'created',
      after: expect.any(Object),
      afterExists: true,
      effectRefs: [{ historyIndex: 2, patchIndex: 0 }],
    });
  });

  it('attributes a descendant value changed by an ancestor replacement to both effects', async () => {
    const headSchema = objectSchema({
      details: objectSchema({ title: stringField('x') }),
    });
    const patches = [
      [
        {
          op: 'replace' as const,
          path: '/properties/details/properties/title',
          value: numberField(2),
        },
      ],
      [
        {
          op: 'replace' as const,
          path: '/properties/details',
          value: objectSchema({
            title: stringField('restored'),
            sibling: stringField(''),
          }),
        },
      ],
    ];
    const history = givenSchemaPatchGroups(headSchema, patches);
    const scenario = await givenCatalogueScenario({
      headSchema,
      draftSchema: history.terminalSchema,
      pending: history.steps,
      headRows: [
        rowInput(CATALOGUE_ROW_CREATED_ID, { details: { title: 'x' } }),
      ],
      draftRows: [
        rowInput(CATALOGUE_ROW_CREATED_ID, {
          details: { title: 'x', sibling: '' },
        }),
      ],
    });

    const schemaEntries = (await buildCatalogue(scenario)).entries.filter(
      ({ kind }) => kind === 'schemaField',
    );
    const title = schemaEntries.find(
      ({ path }) => path === '/properties/details/properties/title',
    );
    const parent = schemaEntries.find(
      ({ path }) => path === '/properties/details',
    );

    expect(title).toMatchObject({
      before: { type: 'string' },
      after: { type: 'number' },
      effectRefs: [{ historyIndex: 1, patchIndex: 0 }],
    });
    expect(parent?.effectRefs).toEqual([{ historyIndex: 2, patchIndex: 0 }]);
  });

  it('maps an added field effect to its terminal path after a later move', async () => {
    const headSchema = objectSchema({ title: stringField() });
    const withTemporary = objectSchema({
      title: stringField(),
      temporary: numberField(),
    });
    const draftSchema = objectSchema({
      title: stringField(),
      quantity: numberField(),
    });
    const scenario = await givenCatalogueScenario({
      headSchema,
      draftSchema,
      pending: [
        {
          patches: [addField('/properties/temporary', numberField())],
          schema: withTemporary,
        },
        {
          patches: [moveField('/properties/temporary', '/properties/quantity')],
          schema: draftSchema,
        },
      ],
      headRows: [rowInput(CATALOGUE_ROW_CREATED_ID, { title: 'Head' })],
      draftRows: [
        rowInput(CATALOGUE_ROW_CREATED_ID, { title: 'Head', quantity: 0 }),
      ],
    });

    const entries = (await buildCatalogue(scenario)).entries.filter(
      ({ kind }) => kind === 'schemaField',
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      path: '/properties/quantity',
      classification: 'created',
      effectRefs: [
        { historyIndex: 1, patchIndex: 0 },
        { historyIndex: 2, patchIndex: 0 },
      ],
    });
  });

  it('moves a descendant schema edit with its renamed ancestor', async () => {
    const headSchema = objectSchema({
      details: objectSchema({ title: stringField() }),
    });
    const editedSchema = objectSchema({
      details: objectSchema({ title: stringField(), label: stringField() }),
    });
    const draftSchema = objectSchema({
      metadata: objectSchema({ title: stringField(), label: stringField() }),
    });
    const scenario = await givenCatalogueScenario({
      headSchema,
      draftSchema,
      pending: [
        {
          patches: [
            addField('/properties/details/properties/label', stringField()),
          ],
          schema: editedSchema,
        },
        {
          patches: [moveField('/properties/details', '/properties/metadata')],
          schema: draftSchema,
        },
      ],
      headRows: [
        rowInput(CATALOGUE_ROW_CREATED_ID, { details: { title: 'Head' } }),
      ],
      draftRows: [
        rowInput(CATALOGUE_ROW_CREATED_ID, {
          metadata: { title: 'Head', label: '' },
        }),
      ],
    });

    const entry = (await buildCatalogue(scenario)).entries.find(
      ({ kind, path }) =>
        kind === 'schemaField' &&
        path === '/properties/metadata/properties/label',
    );

    expect(entry?.effectRefs).toEqual([{ historyIndex: 1, patchIndex: 0 }]);
    expect(
      (await buildCatalogue(scenario)).entries.find(
        ({ kind, path }) =>
          kind === 'schemaField' && path === '/properties/metadata',
      )?.effectRefs,
    ).toEqual([{ historyIndex: 2, patchIndex: 0 }]);
  });

  it('keeps child effect ownership when an ancestor move precedes the child edit', async () => {
    const headSchema = objectSchema({
      details: objectSchema({ title: stringField() }),
    });
    const movedSchema = objectSchema({
      metadata: objectSchema({ title: stringField() }),
    });
    const draftSchema = objectSchema({
      metadata: objectSchema({ title: stringField(), label: stringField() }),
    });
    const scenario = await givenCatalogueScenario({
      headSchema,
      draftSchema,
      pending: [
        {
          patches: [moveField('/properties/details', '/properties/metadata')],
          schema: movedSchema,
        },
        {
          patches: [
            addField('/properties/metadata/properties/label', stringField()),
          ],
          schema: draftSchema,
        },
      ],
      headRows: [
        rowInput(CATALOGUE_ROW_CREATED_ID, { details: { title: 'Head' } }),
      ],
      draftRows: [
        rowInput(CATALOGUE_ROW_CREATED_ID, {
          metadata: { title: 'Head', label: '' },
        }),
      ],
    });
    const entries = (await buildCatalogue(scenario)).entries;

    expect(
      entries.find(
        ({ kind, path }) =>
          kind === 'schemaField' &&
          path === '/properties/metadata/properties/label',
      )?.effectRefs,
    ).toEqual([{ historyIndex: 2, patchIndex: 0 }]);
    expect(
      entries.find(
        ({ kind, path }) =>
          kind === 'schemaField' && path === '/properties/metadata',
      )?.effectRefs,
    ).toEqual([{ historyIndex: 1, patchIndex: 0 }]);
  });

  it('keeps replacement between moves within the same field lineage', async () => {
    const headSchema = objectSchema({ price: numberField() });
    const costSchema = objectSchema({ cost: numberField() });
    const replacedSchema = costSchema;
    const draftSchema = objectSchema({ amount: numberField() });
    const scenario = await givenCatalogueScenario({
      headSchema,
      draftSchema,
      pending: [
        {
          patches: [moveField('/properties/price', '/properties/cost')],
          schema: costSchema,
        },
        {
          patches: [
            {
              op: 'replace',
              path: '/properties/cost',
              value: numberField(),
            },
          ],
          schema: replacedSchema,
        },
        {
          patches: [moveField('/properties/cost', '/properties/amount')],
          schema: draftSchema,
        },
      ],
      headRows: [rowInput(CATALOGUE_ROW_CREATED_ID, { price: 10 })],
      draftRows: [rowInput(CATALOGUE_ROW_CREATED_ID, { amount: 10 })],
    });

    const entry = (await buildCatalogue(scenario)).entries.find(
      ({ kind, path }) =>
        kind === 'schemaField' && path === '/properties/amount',
    );

    expect(entry?.effectRefs).toEqual([
      { historyIndex: 1, patchIndex: 0 },
      { historyIndex: 2, patchIndex: 0 },
      { historyIndex: 3, patchIndex: 0 },
    ]);
  });

  it('keeps formula-definition edits selectable while formula values stay informational', async () => {
    const headFormula = {
      type: 'number' as const,
      default: 0,
      readOnly: true,
      'x-formula': { version: 1 as const, expression: 'price * 2' },
    };
    const draftFormula = {
      ...headFormula,
      'x-formula': { version: 1 as const, expression: 'price * 3' },
    };
    const headSchema = objectSchema({
      price: numberField(),
      total: headFormula,
    });
    const draftSchema = objectSchema({
      price: numberField(),
      total: draftFormula,
    });
    const scenario = await givenCatalogueScenario({
      headSchema,
      draftSchema,
      pending: [
        {
          patches: [
            {
              op: 'replace',
              path: '/properties/total',
              value: draftFormula,
            },
          ],
          schema: draftSchema,
        },
      ],
      headRows: [rowInput(CATALOGUE_ROW_CREATED_ID, { price: 1, total: 2 })],
      draftRows: [rowInput(CATALOGUE_ROW_CREATED_ID, { price: 1, total: 3 })],
    });

    const entries = (await buildCatalogue(scenario)).entries;

    expect(entries).toContainEqual(
      expect.objectContaining({
        kind: 'schemaField',
        path: '/properties/total',
        selectable: true,
      }),
    );
    expect(entries).toContainEqual(
      expect.objectContaining({
        kind: 'rowField',
        path: '/total',
        classification: 'computed',
        selectable: false,
      }),
    );
  });
});
