import {
  givenSchemaProjection,
  moveField,
  numberField,
  objectSchema,
  project,
  removeField,
  requiredProjected,
  requiredProjectionRow,
  replaySchemaHistory,
  rowInput,
  stringField,
} from './support/schema-projection-fixture';

describe('Draft Changes schema projection commit', () => {
  it('projects no schema effects while preserving schema and row data', async () => {
    const schema = objectSchema({ name: stringField() });
    const input = givenSchemaProjection({
      headSchema: schema,
      draftSchema: schema,
      headRows: [rowInput('row-1', { name: 'Head' })],
      draftRows: [rowInput('row-1', { name: 'Draft edit' })],
    });

    const result = requiredProjected(await project(input));

    expect(result.head.schema).toEqual(schema);
    expect(requiredProjectionRow(result.head, 'row-1').data).toEqual({
      name: 'Head',
    });
    expect(requiredProjectionRow(result.draft, 'row-1').data).toEqual({
      name: 'Draft edit',
    });
  });

  it('projects empty row sets', async () => {
    const schema = objectSchema({ name: stringField() });
    const input = givenSchemaProjection({
      headSchema: schema,
      draftSchema: schema,
      headRows: [],
      draftRows: [],
    });

    const result = requiredProjected(await project(input));

    expect(result.head.rows).toEqual([]);
    expect(result.draft.rows).toEqual([]);
  });

  it('commits all recorded sibling field renames as one group', async () => {
    const headSchema = objectSchema({
      price: numberField(),
      quantity: numberField(),
    });
    const draftSchema = objectSchema({
      cost: numberField(),
      count: numberField(),
    });
    const input = givenSchemaProjection({
      headSchema,
      draftSchema,
      headRows: [rowInput('row-1', { price: 10, quantity: 2 })],
      draftRows: [rowInput('row-1', { cost: 10, count: 2 })],
      pending: [
        {
          patches: [
            moveField('/properties/price', '/properties/cost'),
            moveField('/properties/quantity', '/properties/count'),
          ],
          schema: draftSchema,
        },
      ],
      selectedEffects: [
        { historyIndex: 1, patchIndex: 0 },
        { historyIndex: 1, patchIndex: 1 },
      ],
    });

    const result = requiredProjected(await project(input));

    expect(result.head.schema).toEqual(draftSchema);
    expect(requiredProjectionRow(result.head, 'row-1').data).toEqual({
      cost: 10,
      count: 2,
    });
    expect(result.draft.schema).toEqual(draftSchema);
    expect(requiredProjectionRow(result.draft, 'row-1').data).toEqual({
      cost: 10,
      count: 2,
    });
  });

  it('commits one sibling field effect while retaining the other in Draft', async () => {
    const headSchema = objectSchema({
      price: numberField(),
      quantity: numberField(),
    });
    const headProjectionSchema = objectSchema({
      cost: numberField(),
      quantity: numberField(),
    });
    const draftSchema = objectSchema({
      cost: numberField(),
      count: numberField(),
    });
    const input = givenSchemaProjection({
      headSchema,
      draftSchema,
      headRows: [rowInput('row-1', { price: 10, quantity: 2 })],
      draftRows: [rowInput('row-1', { cost: 10, count: 3 })],
      pending: [
        {
          patches: [
            moveField('/properties/price', '/properties/cost'),
            moveField('/properties/quantity', '/properties/count'),
          ],
          schema: draftSchema,
        },
      ],
      selectedEffects: [{ historyIndex: 1, patchIndex: 0 }],
    });

    const result = requiredProjected(await project(input));

    expect(result.head.schema).toEqual(headProjectionSchema);
    expect(requiredProjectionRow(result.head, 'row-1').data).toEqual({
      cost: 10,
      quantity: 2,
    });
    expect(result.draft.schema).toEqual(draftSchema);
    expect(requiredProjectionRow(result.draft, 'row-1').data).toEqual({
      cost: 10,
      count: 3,
    });
    expect(replaySchemaHistory(headSchema, result.head.history)).toEqual(
      result.head.schema,
    );
    expect(
      replaySchemaHistory(
        result.head.schema,
        result.draft.history.slice(result.head.history.length),
        0,
      ),
    ).toEqual(result.draft.schema);
  });

  it('migrates the Head baseline and preserves independent Draft data edits', async () => {
    const headSchema = objectSchema({
      price: numberField(),
      note: stringField(),
    });
    const draftSchema = objectSchema({
      cost: numberField(),
      note: stringField(),
    });
    const input = givenSchemaProjection({
      headSchema,
      draftSchema,
      headRows: [rowInput('row-1', { price: 10, note: 'head' })],
      draftRows: [rowInput('row-1', { cost: 10, note: 'draft edit' })],
      pending: [
        {
          patches: [moveField('/properties/price', '/properties/cost')],
          schema: draftSchema,
        },
      ],
      selectedEffects: [{ historyIndex: 1, patchIndex: 0 }],
    });

    const result = requiredProjected(await project(input));

    expect(result.migratedHead.schema).toEqual(draftSchema);
    expect(requiredProjectionRow(result.migratedHead, 'row-1').data).toEqual({
      cost: 10,
      note: 'head',
    });
    expect(requiredProjectionRow(result.draft, 'row-1').data).toEqual({
      cost: 10,
      note: 'draft edit',
    });
  });

  it('keeps the Head schema when the selected effect set is empty', async () => {
    const headSchema = objectSchema({ price: numberField() });
    const draftSchema = objectSchema({ cost: numberField() });
    const input = givenSchemaProjection({
      headSchema,
      draftSchema,
      pending: [
        {
          patches: [moveField('/properties/price', '/properties/cost')],
          schema: draftSchema,
        },
      ],
    });

    const result = requiredProjected(await project(input));

    expect(result.head.schema).toEqual(headSchema);
    expect(result.draft.schema).toEqual(draftSchema);
  });

  it('normalizes a renamed field before removing it in a later update', async () => {
    const headSchema = objectSchema({
      price: numberField(),
      title: stringField(),
    });
    const renamedSchema = objectSchema({
      cost: numberField(),
      title: stringField(),
    });
    const draftSchema = objectSchema({ title: stringField() });
    const input = givenSchemaProjection({
      headSchema,
      draftSchema,
      headRows: [rowInput('row-1', { price: 10, title: 'Head' })],
      draftRows: [rowInput('row-1', { title: 'Head' })],
      pending: [
        {
          patches: [moveField('/properties/price', '/properties/cost')],
          schema: renamedSchema,
        },
        {
          patches: [removeField('/properties/cost')],
          schema: draftSchema,
        },
      ],
      selectedEffects: [
        { historyIndex: 1, patchIndex: 0 },
        { historyIndex: 2, patchIndex: 0 },
      ],
    });

    const result = requiredProjected(await project(input));

    expect(result.migratedHead.schema).toEqual(draftSchema);
    expect(requiredProjectionRow(result.migratedHead, 'row-1').data).toEqual({
      title: 'Head',
    });
  });

  it('replays a replacement after an intervening add-only update', async () => {
    const headSchema = objectSchema({
      price: numberField(),
      title: stringField(),
    });
    const renamedSchema = objectSchema({
      cost: numberField(),
      title: stringField(),
    });
    const addedSchema = objectSchema({
      cost: numberField(),
      other: stringField(),
      title: stringField(),
    });
    const draftSchema = objectSchema({
      cost: stringField(),
      other: stringField(),
      title: stringField(),
    });
    const input = givenSchemaProjection({
      headSchema,
      draftSchema,
      headRows: [rowInput('row-1', { price: 10, title: 'Head' })],
      draftRows: [rowInput('row-1', { cost: '10', other: '', title: 'Draft' })],
      pending: [
        {
          patches: [moveField('/properties/price', '/properties/cost')],
          schema: renamedSchema,
        },
        {
          patches: [
            { op: 'add', path: '/properties/other', value: stringField() },
          ],
          schema: addedSchema,
        },
        {
          patches: [
            { op: 'replace', path: '/properties/cost', value: stringField() },
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

    expect(result.head.schema).toEqual(draftSchema);
    expect(requiredProjectionRow(result.head, 'row-1').data).toEqual({
      cost: '10',
      other: '',
      title: 'Head',
    });
  });

  it('keeps a pure chain of field renames replayable', async () => {
    const headSchema = objectSchema({ price: numberField() });
    const costSchema = objectSchema({ cost: numberField() });
    const amountSchema = objectSchema({ amount: numberField() });
    const input = givenSchemaProjection({
      headSchema,
      draftSchema: amountSchema,
      headRows: [rowInput('row-1', { price: 10 })],
      draftRows: [rowInput('row-1', { amount: 10 })],
      pending: [
        {
          patches: [moveField('/properties/price', '/properties/cost')],
          schema: costSchema,
        },
        {
          patches: [moveField('/properties/cost', '/properties/amount')],
          schema: amountSchema,
        },
      ],
      selectedEffects: [
        { historyIndex: 1, patchIndex: 0 },
        { historyIndex: 2, patchIndex: 0 },
      ],
    });

    const result = requiredProjected(await project(input));

    expect(result.head.schema).toEqual(amountSchema);
    expect(requiredProjectionRow(result.head, 'row-1').data).toEqual({
      amount: 10,
    });
  });
});
