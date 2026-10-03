import {
  addField,
  givenSchemaProjection,
  moveField,
  numberField,
  objectSchema,
  project,
  requiredBlocked,
  requiredProjectionBlocker,
  requiredProjected,
  requiredProjectionRow,
  removeField,
  rowInput,
  stringField,
} from './support/schema-projection-fixture';

describe('Draft Changes schema projection blockers', () => {
  it('blocks an effect reference to a Head history entry', async () => {
    const schema = objectSchema({ price: numberField() });
    const input = givenSchemaProjection({
      headSchema: schema,
      draftSchema: schema,
      selectedEffects: [{ historyIndex: 0, patchIndex: 0 }],
    });

    const result = requiredBlocked(await project(input));

    expect(requiredProjectionBlocker(result).code).toBe(
      'INVALID_EFFECT_REFERENCE',
    );
  });

  it('blocks an out-of-range history reference', async () => {
    const schema = objectSchema({ price: numberField() });
    const input = givenSchemaProjection({
      headSchema: schema,
      draftSchema: schema,
      selectedEffects: [{ historyIndex: 4, patchIndex: 0 }],
    });

    const result = requiredBlocked(await project(input));

    expect(requiredProjectionBlocker(result).code).toBe(
      'INVALID_EFFECT_REFERENCE',
    );
  });

  it('blocks a non-integer patch reference', async () => {
    const input = givenSchemaProjection({
      headSchema: objectSchema({ price: numberField() }),
      draftSchema: objectSchema({ cost: numberField() }),
      pending: [
        {
          patches: [moveField('/properties/price', '/properties/cost')],
          schema: objectSchema({ cost: numberField() }),
        },
      ],
      selectedEffects: [{ historyIndex: 1, patchIndex: 0.5 }],
    });

    const result = requiredBlocked(await project(input));

    expect(requiredProjectionBlocker(result).code).toBe(
      'INVALID_EFFECT_REFERENCE',
    );
  });

  it('blocks when the selected schema effect has no Draft table counterpart', async () => {
    const schema = objectSchema({ price: numberField() });
    const input = givenSchemaProjection({
      headSchema: schema,
      draftSchema: schema,
      missingDraftTable: true,
    });

    const result = requiredBlocked(await project(input));

    expect(requiredProjectionBlocker(result).code).toBe(
      'TABLE_COUNTERPART_MISSING',
    );
  });

  it('blocks when the selected schema effect has no Head table counterpart', async () => {
    const schema = objectSchema({ price: numberField() });
    const input = givenSchemaProjection({
      headSchema: schema,
      draftSchema: schema,
      missingHeadTable: true,
    });

    const result = requiredBlocked(await project(input));

    expect(requiredProjectionBlocker(result).code).toBe(
      'TABLE_COUNTERPART_MISSING',
    );
  });

  it('blocks a Draft schema row with ambiguous table identity', async () => {
    const schema = objectSchema({ price: numberField() });
    const input = givenSchemaProjection({
      headSchema: schema,
      draftSchema: schema,
      duplicateDraftSchemaRow: true,
    });

    const result = requiredBlocked(await project(input));

    expect(requiredProjectionBlocker(result).code).toBe(
      'SCHEMA_IDENTITY_AMBIGUOUS',
    );
  });

  it('blocks a missing schema row instead of selecting an arbitrary record', async () => {
    const schema = objectSchema({ price: numberField() });
    const input = givenSchemaProjection({
      headSchema: schema,
      draftSchema: schema,
      missingDraftSchemaRow: true,
    });

    const result = requiredBlocked(await project(input));

    expect(requiredProjectionBlocker(result).code).toBe(
      'SCHEMA_IDENTITY_MISSING',
    );
  });

  it('blocks a missing Head schema row', async () => {
    const schema = objectSchema({ price: numberField() });
    const input = givenSchemaProjection({
      headSchema: schema,
      draftSchema: schema,
      missingHeadSchemaRow: true,
    });

    const result = requiredBlocked(await project(input));

    expect(requiredProjectionBlocker(result).code).toBe(
      'SCHEMA_IDENTITY_MISSING',
    );
  });

  it('blocks an ambiguous Head schema row', async () => {
    const schema = objectSchema({ price: numberField() });
    const input = givenSchemaProjection({
      headSchema: schema,
      draftSchema: schema,
      duplicateHeadSchemaRow: true,
    });

    const result = requiredBlocked(await project(input));

    expect(requiredProjectionBlocker(result).code).toBe(
      'SCHEMA_IDENTITY_AMBIGUOUS',
    );
  });

  it('returns blockers without a partial persistable candidate', async () => {
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
      selectedEffects: [{ historyIndex: 4, patchIndex: 0 }],
    });

    const result = await project(input);
    expect(result).not.toHaveProperty('head');
    expect(result).not.toHaveProperty('draft');
    expect(result).not.toHaveProperty('migratedHead');
  });

  it('unions duplicate references to the same recorded effect', async () => {
    const headSchema = objectSchema({ oldName: stringField() });
    const draftSchema = objectSchema({ newName: stringField() });
    const input = givenSchemaProjection({
      headSchema,
      draftSchema,
      pending: [
        {
          patches: [moveField('/properties/oldName', '/properties/newName')],
          schema: draftSchema,
        },
      ],
      selectedEffects: [
        { historyIndex: 1, patchIndex: 0 },
        { historyIndex: 1, patchIndex: 0 },
      ],
    });

    const result = requiredProjected(await project(input));

    expect(result.selectedEffects).toEqual([
      { historyIndex: 1, patchIndex: 0 },
    ]);
  });

  it('does not treat an effect after removal and re-addition as the removed field', async () => {
    const headSchema = objectSchema({ price: numberField() });
    const removedSchema = objectSchema({});
    const readdedSchema = objectSchema({ price: numberField(0) });
    const input = givenSchemaProjection({
      headSchema,
      draftSchema: readdedSchema,
      headRows: [{ createdId: 'row-1', data: { price: 7 } }],
      draftRows: [{ createdId: 'row-1', data: { price: 0 } }],
      pending: [
        { patches: [removeField('/properties/price')], schema: removedSchema },
        {
          patches: [addField('/properties/price', numberField(0))],
          schema: readdedSchema,
        },
      ],
    });

    const result = requiredProjected(await project(input));

    expect(result.migratedHead.rows).toEqual([
      { createdId: 'row-1', data: { price: 0 } },
    ]);
  });

  it('blocks user data on a re-added field when discarding both schema effects', async () => {
    const headSchema = objectSchema({ price: numberField() });
    const removedSchema = objectSchema({});
    const readdedSchema = objectSchema({ price: numberField(0) });
    const input = givenSchemaProjection({
      operation: 'discard',
      headSchema,
      draftSchema: readdedSchema,
      headRows: [rowInput('row-1', { price: 7 })],
      draftRows: [rowInput('row-1', { price: 2 })],
      pending: [
        { patches: [removeField('/properties/price')], schema: removedSchema },
        {
          patches: [addField('/properties/price', numberField(0))],
          schema: readdedSchema,
        },
      ],
      selectedEffects: [
        { historyIndex: 1, patchIndex: 0 },
        { historyIndex: 2, patchIndex: 0 },
      ],
    });

    const result = requiredBlocked(await project(input));

    expect(requiredProjectionBlocker(result)).toMatchObject({
      code: 'UNREPRESENTABLE_REMAINDER',
      rowCreatedId: 'row-1',
      path: '/price',
    });
  });

  it('discards a re-added field without replacing the original Head value', async () => {
    const headSchema = objectSchema({ price: numberField() });
    const removedSchema = objectSchema({});
    const readdedSchema = objectSchema({ price: numberField(0) });
    const input = givenSchemaProjection({
      operation: 'discard',
      headSchema,
      draftSchema: readdedSchema,
      headRows: [rowInput('row-1', { price: 7 })],
      draftRows: [rowInput('row-1', { price: 2 })],
      pending: [
        { patches: [removeField('/properties/price')], schema: removedSchema },
        {
          patches: [addField('/properties/price', numberField(0))],
          schema: readdedSchema,
        },
      ],
      selectedEffects: [
        { historyIndex: 1, patchIndex: 0 },
        { historyIndex: 2, patchIndex: 0 },
      ],
      discardedDataFields: [{ rowCreatedId: 'row-1', path: '/price' }],
    });

    const result = requiredProjected(await project(input));

    expect(requiredProjectionRow(result.draft, 'row-1').data).toEqual({
      price: 7,
    });
  });
});
