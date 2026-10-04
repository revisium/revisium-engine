import {
  arraySchema,
  givenSchemaProjection,
  moveField,
  numberField,
  objectSchema,
  project,
  requiredBlocked,
  requiredProjected,
  requiredProjectionBlocker,
  requiredProjectionRow,
  rowInput,
  stringField,
} from './support/schema-projection-fixture';

describe('Draft Changes schema projection array discard', () => {
  it('blocks an edited field removed while remapping an edited containing array', async () => {
    const headSchema = objectSchema({
      entries: arraySchema(objectSchema({ price: numberField() })),
    });
    const draftSchema = objectSchema({
      entries: arraySchema(
        objectSchema({ price: numberField(), label: stringField() }),
      ),
    });
    const input = givenSchemaProjection({
      operation: 'discard',
      headSchema,
      draftSchema,
      headRows: [rowInput('row-1', { entries: [{ price: 10 }] })],
      draftRows: [
        rowInput('row-1', { entries: [{ price: 11, label: 'edited' }] }),
      ],
      pending: [
        {
          patches: [
            {
              op: 'add',
              path: '/properties/entries/items/properties/label',
              value: stringField(),
            },
          ],
          schema: draftSchema,
        },
      ],
      selectedEffects: [{ historyIndex: 1, patchIndex: 0 }],
    });

    const result = requiredBlocked(await project(input));

    expect(requiredProjectionBlocker(result)).toMatchObject({
      code: 'UNREPRESENTABLE_REMAINDER',
      rowCreatedId: 'row-1',
      path: '/entries',
    });
  });

  it('drops an edited removed array field only when the array is explicitly discarded', async () => {
    const headSchema = objectSchema({
      entries: arraySchema(objectSchema({ price: numberField() })),
    });
    const draftSchema = objectSchema({
      entries: arraySchema(
        objectSchema({ price: numberField(), label: stringField() }),
      ),
    });
    const input = givenSchemaProjection({
      operation: 'discard',
      headSchema,
      draftSchema,
      headRows: [rowInput('row-1', { entries: [{ price: 10 }] })],
      draftRows: [
        rowInput('row-1', { entries: [{ price: 11, label: 'edited' }] }),
      ],
      pending: [
        {
          patches: [
            {
              op: 'add',
              path: '/properties/entries/items/properties/label',
              value: stringField(),
            },
          ],
          schema: draftSchema,
        },
      ],
      selectedEffects: [{ historyIndex: 1, patchIndex: 0 }],
      discardedDataFields: [{ rowCreatedId: 'row-1', path: '/entries' }],
    });

    const result = requiredProjected(await project(input));

    expect(requiredProjectionRow(result.draft, 'row-1').data).toEqual({
      entries: [{ price: 11 }],
    });
  });

  it('restores defaults for appended array items when retaining removed Head fields', async () => {
    const headSchema = objectSchema({
      entries: arraySchema(
        objectSchema({ price: numberField(), obsolete: numberField() }),
      ),
    });
    const draftSchema = objectSchema({
      entries: arraySchema(objectSchema({ price: numberField() })),
    });
    const input = givenSchemaProjection({
      operation: 'discard',
      headSchema,
      draftSchema,
      headRows: [rowInput('row-1', { entries: [{ price: 10, obsolete: 7 }] })],
      draftRows: [
        rowInput('row-1', { entries: [{ price: 11 }, { price: 20 }] }),
      ],
      pending: [
        {
          patches: [
            {
              op: 'remove',
              path: '/properties/entries/items/properties/obsolete',
            },
          ],
          schema: draftSchema,
        },
      ],
      selectedEffects: [{ historyIndex: 1, patchIndex: 0 }],
    });

    const result = requiredProjected(await project(input));

    expect(requiredProjectionRow(result.draft, 'row-1').data).toEqual({
      entries: [
        { price: 11, obsolete: 7 },
        { price: 20, obsolete: 0 },
      ],
    });
  });

  it('reports the current Draft array as the atomic requirement for an invalid item', async () => {
    const headSchema = objectSchema({
      entries: arraySchema(objectSchema({ price: numberField() })),
      title: stringField(),
    });
    const draftSchema = objectSchema({
      entries: arraySchema(objectSchema({ price: stringField() })),
      title: stringField(),
    });
    const input = givenSchemaProjection({
      operation: 'discard',
      headSchema,
      draftSchema,
      headRows: [
        rowInput('row-1', { entries: [{ price: 10 }], title: 'Head' }),
      ],
      draftRows: [
        rowInput('row-1', { entries: [{ price: 'custom' }], title: 'Draft' }),
      ],
      pending: [
        {
          patches: [
            {
              op: 'replace',
              path: '/properties/entries/items/properties/price',
              value: stringField(),
            },
          ],
          schema: draftSchema,
        },
      ],
      selectedEffects: [{ historyIndex: 1, patchIndex: 0 }],
    });

    const result = requiredBlocked(await project(input));

    expect(requiredProjectionBlocker(result)).toMatchObject({
      code: 'UNREPRESENTABLE_REMAINDER',
      path: '/entries',
      requiredDataFields: [{ rowCreatedId: 'row-1', path: '/entries' }],
    });
  });

  it('restores the target array when returned authorization names a renamed Draft array', async () => {
    const headSchema = objectSchema({
      entries: arraySchema(objectSchema({ price: numberField() })),
      title: stringField(),
    });
    const renamedSchema = objectSchema({
      lines: arraySchema(objectSchema({ price: numberField() })),
      title: stringField(),
    });
    const draftSchema = objectSchema({
      lines: arraySchema(objectSchema({ price: stringField() })),
      title: stringField(),
    });
    const options = {
      operation: 'discard' as const,
      headSchema,
      draftSchema,
      headRows: [
        rowInput('row-1', { entries: [{ price: 10 }], title: 'Head' }),
      ],
      draftRows: [
        rowInput('row-1', { lines: [{ price: 'custom' }], title: 'Draft' }),
      ],
      pending: [
        {
          patches: [moveField('/properties/entries', '/properties/lines')],
          schema: renamedSchema,
        },
        {
          patches: [
            {
              op: 'replace' as const,
              path: '/properties/lines/items/properties/price',
              value: stringField(),
            },
          ],
          schema: draftSchema,
        },
      ],
      selectedEffects: [
        { historyIndex: 1, patchIndex: 0 },
        { historyIndex: 2, patchIndex: 0 },
      ],
    };
    const blocked = requiredBlocked(
      await project(givenSchemaProjection(options)),
    );
    const blocker = requiredProjectionBlocker(blocked);
    expect(blocker).toMatchObject({ path: '/lines' });
    const authorized = givenSchemaProjection({
      ...options,
      discardedDataFields: blocker.requiredDataFields,
    });

    const result = requiredProjected(await project(authorized));

    expect(requiredProjectionRow(result.draft, 'row-1').data).toEqual({
      entries: [{ price: 10 }],
      title: 'Draft',
    });
  });

  it('uses the returned root-array authorization to restore the Head array', async () => {
    const headSchema = arraySchema(objectSchema({ price: numberField() }));
    const draftSchema = arraySchema(objectSchema({ price: stringField() }));
    const options = {
      operation: 'discard' as const,
      headSchema,
      draftSchema,
      headRows: [rowInput('row-1', [{ price: 10 }])],
      draftRows: [rowInput('row-1', [{ price: 'custom' }])],
      pending: [
        {
          patches: [
            {
              op: 'replace' as const,
              path: '/items/properties/price',
              value: stringField(),
            },
          ],
          schema: draftSchema,
        },
      ],
      selectedEffects: [{ historyIndex: 1, patchIndex: 0 }],
    };
    const blocked = requiredBlocked(
      await project(givenSchemaProjection(options)),
    );
    const blocker = requiredProjectionBlocker(blocked);
    expect(blocker).toMatchObject({
      path: '',
      requiredDataFields: [{ rowCreatedId: 'row-1', path: '' }],
    });

    const result = requiredProjected(
      await project(
        givenSchemaProjection({
          ...options,
          discardedDataFields: blocker.requiredDataFields,
        }),
      ),
    );

    expect(requiredProjectionRow(result.draft, 'row-1').data).toEqual([
      { price: 10 },
    ]);
  });

  it('uses the outer array requirement to restore nested array item data', async () => {
    const headSchema = objectSchema({
      entries: arraySchema(
        objectSchema({
          nested: arraySchema(objectSchema({ price: numberField() })),
        }),
      ),
      title: stringField(),
    });
    const draftSchema = objectSchema({
      entries: arraySchema(
        objectSchema({
          nested: arraySchema(objectSchema({ price: stringField() })),
        }),
      ),
      title: stringField(),
    });
    const options = {
      operation: 'discard' as const,
      headSchema,
      draftSchema,
      headRows: [
        rowInput('row-1', {
          entries: [{ nested: [{ price: 10 }] }],
          title: 'Head',
        }),
      ],
      draftRows: [
        rowInput('row-1', {
          entries: [{ nested: [{ price: 'custom' }] }],
          title: 'Draft',
        }),
      ],
      pending: [
        {
          patches: [
            {
              op: 'replace' as const,
              path: '/properties/entries/items/properties/nested/items/properties/price',
              value: stringField(),
            },
          ],
          schema: draftSchema,
        },
      ],
      selectedEffects: [{ historyIndex: 1, patchIndex: 0 }],
    };
    const blocked = requiredBlocked(
      await project(givenSchemaProjection(options)),
    );
    const blocker = requiredProjectionBlocker(blocked);
    expect(blocker.requiredDataFields).toEqual([
      { rowCreatedId: 'row-1', path: '/entries' },
    ]);

    const result = requiredProjected(
      await project(
        givenSchemaProjection({
          ...options,
          discardedDataFields: blocker.requiredDataFields,
        }),
      ),
    );

    expect(requiredProjectionRow(result.draft, 'row-1').data).toEqual({
      entries: [{ nested: [{ price: 10 }] }],
      title: 'Draft',
    });
  });

  it('discards an edited newly added array only with array-level authorization', async () => {
    const headSchema = objectSchema({ title: stringField() });
    const draftSchema = objectSchema({
      title: stringField(),
      entries: arraySchema(objectSchema({ price: numberField() })),
    });
    const input = givenSchemaProjection({
      operation: 'discard',
      headSchema,
      draftSchema,
      headRows: [rowInput('row-1', { title: 'Head' })],
      draftRows: [
        rowInput('row-1', { title: 'Independent', entries: [{ price: 11 }] }),
      ],
      pending: [
        {
          patches: [
            {
              op: 'add',
              path: '/properties/entries',
              value: arraySchema(objectSchema({ price: numberField() })),
            },
          ],
          schema: draftSchema,
        },
      ],
      selectedEffects: [{ historyIndex: 1, patchIndex: 0 }],
      discardedDataFields: [{ rowCreatedId: 'row-1', path: '/entries' }],
    });

    const result = requiredProjected(await project(input));

    expect(requiredProjectionRow(result.draft, 'row-1').data).toEqual({
      title: 'Independent',
    });
  });

  it('discards an incompatible replacement inside an edited array atomically', async () => {
    const headSchema = objectSchema({
      entries: arraySchema(objectSchema({ price: numberField() })),
    });
    const draftSchema = objectSchema({
      entries: arraySchema(objectSchema({ price: stringField() })),
    });
    const input = givenSchemaProjection({
      operation: 'discard',
      headSchema,
      draftSchema,
      headRows: [rowInput('row-1', { entries: [{ price: 10 }] })],
      draftRows: [rowInput('row-1', { entries: [{ price: 'custom' }] })],
      pending: [
        {
          patches: [
            {
              op: 'replace',
              path: '/properties/entries/items/properties/price',
              value: stringField(),
            },
          ],
          schema: draftSchema,
        },
      ],
      selectedEffects: [{ historyIndex: 1, patchIndex: 0 }],
      discardedDataFields: [{ rowCreatedId: 'row-1', path: '/entries' }],
    });

    const result = requiredProjected(await project(input));

    expect(requiredProjectionRow(result.draft, 'row-1').data).toEqual({
      entries: [{ price: 10 }],
    });
  });
});
