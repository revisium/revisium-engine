import {
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

describe('Draft Changes schema projection coordinates', () => {
  it('maps reserved and escaped field names as JSON pointers', async () => {
    const headSchema = objectSchema({
      properties: numberField(),
      'a/b~c': numberField(),
    });
    const renamedSchema = objectSchema({
      renamed: numberField(),
      'a/b~c': numberField(),
    });
    const input = givenSchemaProjection({
      headSchema,
      draftSchema: renamedSchema,
      headRows: [rowInput('row-1', { properties: 1, 'a/b~c': 2 })],
      draftRows: [rowInput('row-1', { renamed: 1, 'a/b~c': 2 })],
      pending: [
        {
          patches: [
            {
              op: 'move',
              from: '/properties/properties',
              path: '/properties/renamed',
            },
          ],
          schema: renamedSchema,
        },
      ],
    });

    const result = requiredProjected(await project(input));

    expect(result.rowFieldMappings).toContainEqual({
      fromPath: '/renamed',
      toPath: '/properties',
    });
    expect(result.rowFieldMappings).toContainEqual({
      fromPath: '/a~1b~0c',
      toPath: '/a~1b~0c',
    });
  });

  it('maps remaining Draft coordinates to the partially committed target schema', async () => {
    const headSchema = objectSchema({ price: numberField() });
    const costSchema = objectSchema({ cost: numberField() });
    const amountSchema = objectSchema({ amount: numberField() });
    const input = givenSchemaProjection({
      headSchema,
      draftSchema: amountSchema,
      headRows: [rowInput('row-1', { price: 8 })],
      draftRows: [rowInput('row-1', { amount: 9 })],
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
      selectedEffects: [{ historyIndex: 1, patchIndex: 0 }],
    });

    const result = requiredProjected(await project(input));

    expect(result.rowTargetFieldMappings).toContainEqual({
      fromPath: '/amount',
      toPath: '/cost',
    });
    expect(requiredProjectionRow(result.draft, 'row-1').data).toEqual({
      amount: 9,
    });
  });

  it('maps a pending edit after a retained rename into the target field', async () => {
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
      draftRows: [rowInput('row-1', { cost: 12, note: 'draft' })],
      pending: [
        {
          patches: [moveField('/properties/price', '/properties/cost')],
          schema: draftSchema,
        },
      ],
    });

    const result = requiredProjected(await project(input));

    expect(result.rowTargetFieldMappings).toContainEqual({
      fromPath: '/cost',
      toPath: '/price',
    });
    expect(requiredProjectionRow(result.draft, 'row-1').data).toEqual({
      cost: 12,
      note: 'draft',
    });
  });
});
