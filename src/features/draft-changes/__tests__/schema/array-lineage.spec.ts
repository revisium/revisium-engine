import {
  arraySchema,
  givenSchemaProjection,
  moveField,
  numberField,
  objectSchema,
  project,
  requiredProjected,
  requiredProjectionRow,
  rowInput,
  stringField,
} from './support/schema-projection-fixture';

describe('Draft Changes schema projection array lineage', () => {
  it('preserves a moved value across object parents inside an array item', async () => {
    const headSchema = objectSchema({
      entries: arraySchema(
        objectSchema({
          left: objectSchema({ price: numberField() }),
          right: objectSchema({}),
        }),
      ),
    });
    const draftSchema = objectSchema({
      entries: arraySchema(
        objectSchema({
          left: objectSchema({}),
          right: objectSchema({ cost: numberField() }),
        }),
      ),
    });
    const input = givenSchemaProjection({
      operation: 'discard',
      headSchema,
      draftSchema,
      headRows: [
        rowInput('row-1', { entries: [{ left: { price: 10 }, right: {} }] }),
      ],
      draftRows: [
        rowInput('row-1', { entries: [{ left: {}, right: { cost: 15 } }] }),
      ],
      pending: [
        {
          patches: [
            {
              op: 'move',
              from: '/properties/entries/items/properties/left/properties/price',
              path: '/properties/entries/items/properties/right/properties/cost',
            },
          ],
          schema: draftSchema,
        },
      ],
      selectedEffects: [{ historyIndex: 1, patchIndex: 0 }],
    });

    const result = requiredProjected(await project(input));

    expect(requiredProjectionRow(result.draft, 'row-1').data).toEqual({
      entries: [{ left: { price: 15 }, right: {} }],
    });
  });

  it('preserves an edited nested object value inside an array item', async () => {
    const headSchema = objectSchema({
      entries: arraySchema(
        objectSchema({ nested: objectSchema({ price: numberField() }) }),
      ),
    });
    const draftSchema = objectSchema({
      entries: arraySchema(
        objectSchema({ nested: objectSchema({ cost: numberField() }) }),
      ),
    });
    const input = givenSchemaProjection({
      operation: 'discard',
      headSchema,
      draftSchema,
      headRows: [rowInput('row-1', { entries: [{ nested: { price: 10 } }] })],
      draftRows: [rowInput('row-1', { entries: [{ nested: { cost: 15 } }] })],
      pending: [
        {
          patches: [
            moveField(
              '/properties/entries/items/properties/nested/properties/price',
              '/properties/entries/items/properties/nested/properties/cost',
            ),
          ],
          schema: draftSchema,
        },
      ],
      selectedEffects: [{ historyIndex: 1, patchIndex: 0 }],
    });

    const result = requiredProjected(await project(input));

    expect(requiredProjectionRow(result.draft, 'row-1').data).toEqual({
      entries: [{ nested: { price: 15 } }],
    });
  });

  it('preserves a value moved out of an added object parent in an array item', async () => {
    const headSchema = objectSchema({
      entries: arraySchema(
        objectSchema({ left: objectSchema({ price: numberField() }) }),
      ),
    });
    const addedSchema = objectSchema({
      entries: arraySchema(
        objectSchema({
          left: objectSchema({ price: numberField() }),
          right: objectSchema({}),
        }),
      ),
    });
    const movedSchema = objectSchema({
      entries: arraySchema(
        objectSchema({
          left: objectSchema({}),
          right: objectSchema({ cost: numberField() }),
        }),
      ),
    });
    const draftSchema = objectSchema({
      entries: arraySchema(
        objectSchema({ right: objectSchema({ cost: numberField() }) }),
      ),
    });
    const input = givenSchemaProjection({
      operation: 'discard',
      headSchema,
      draftSchema,
      headRows: [rowInput('row-1', { entries: [{ left: { price: 10 } }] })],
      draftRows: [rowInput('row-1', { entries: [{ right: { cost: 15 } }] })],
      pending: [
        {
          patches: [
            {
              op: 'add',
              path: '/properties/entries/items/properties/right',
              value: objectSchema({}),
            },
          ],
          schema: addedSchema,
        },
        {
          patches: [
            moveField(
              '/properties/entries/items/properties/left/properties/price',
              '/properties/entries/items/properties/right/properties/cost',
            ),
          ],
          schema: movedSchema,
        },
        {
          patches: [
            {
              op: 'remove',
              path: '/properties/entries/items/properties/left',
            },
          ],
          schema: draftSchema,
        },
      ],
      selectedEffects: [
        { historyIndex: 1, patchIndex: 0 },
        { historyIndex: 2, patchIndex: 0 },
        { historyIndex: 3, patchIndex: 0 },
      ],
    });

    const result = requiredProjected(await project(input));

    expect(requiredProjectionRow(result.draft, 'row-1').data).toEqual({
      entries: [{ left: { price: 15 } }],
    });
  });

  it('keeps arrays atomic when an array-valued field is renamed', async () => {
    const itemSchema = objectSchema({ label: stringField() });
    const headSchema = objectSchema({ entries: arraySchema(itemSchema) });
    const draftSchema = objectSchema({ records: arraySchema(itemSchema) });
    const data = { entries: [{ label: 'first' }, { label: 'second' }] };
    const input = givenSchemaProjection({
      operation: 'discard',
      headSchema,
      draftSchema,
      headRows: [rowInput('row-1', data)],
      draftRows: [rowInput('row-1', { records: [{ label: 'draft value' }] })],
      pending: [
        {
          patches: [moveField('/properties/entries', '/properties/records')],
          schema: draftSchema,
        },
      ],
      selectedEffects: [{ historyIndex: 1, patchIndex: 0 }],
    });

    const result = requiredProjected(await project(input));

    expect(result.draft.schema).toEqual(headSchema);
    expect(requiredProjectionRow(result.draft, 'row-1').data).toEqual({
      entries: [{ label: 'draft value' }],
    });
  });

  it('preserves edited values when renaming a field inside array items', async () => {
    const headSchema = arraySchema(objectSchema({ price: numberField() }));
    const draftSchema = arraySchema(objectSchema({ cost: numberField() }));
    const input = givenSchemaProjection({
      operation: 'discard',
      headSchema,
      draftSchema,
      headRows: [rowInput('row-1', [{ price: 10 }, { price: 20 }])],
      draftRows: [rowInput('row-1', [{ cost: 11 }, { cost: 20 }])],
      pending: [
        {
          patches: [
            moveField('/items/properties/price', '/items/properties/cost'),
          ],
          schema: draftSchema,
        },
      ],
      selectedEffects: [{ historyIndex: 1, patchIndex: 0 }],
    });

    const result = requiredProjected(await project(input));

    expect(result.draft.schema).toEqual(headSchema);
    expect(requiredProjectionRow(result.draft, 'row-1').data).toEqual([
      { price: 11 },
      { price: 20 },
    ]);
  });
});
