import {
  givenSchemaProjection,
  moveField,
  numberField,
  objectSchema,
  project,
  requiredBlocked,
  requiredProjectionBlocker,
  requiredProjected,
  requiredProjectionRow,
  rowInput,
  stringField,
} from './support/schema-projection-fixture';

describe('Draft Changes schema projection replacement', () => {
  it('projects a recorded field type replacement', async () => {
    const headSchema = objectSchema({ price: numberField() });
    const draftSchema = objectSchema({ price: stringField() });
    const input = givenSchemaProjection({
      headSchema,
      draftSchema,
      headRows: [rowInput('row-1', { price: 10 })],
      draftRows: [rowInput('row-1', { price: '10' })],
      pending: [
        {
          patches: [
            { op: 'replace', path: '/properties/price', value: stringField() },
          ],
          schema: draftSchema,
        },
      ],
      selectedEffects: [{ historyIndex: 1, patchIndex: 0 }],
    });

    const result = requiredProjected(await project(input));

    expect(result.head.schema).toEqual(draftSchema);
    expect(requiredProjectionRow(result.head, 'row-1').data).toEqual({
      price: '10',
    });
  });

  it('restores the Head type when discarding an unchanged replacement value', async () => {
    const headSchema = objectSchema({ price: numberField() });
    const draftSchema = objectSchema({ price: stringField() });
    const input = givenSchemaProjection({
      operation: 'discard',
      headSchema,
      draftSchema,
      headRows: [rowInput('row-1', { price: 10 })],
      draftRows: [rowInput('row-1', { price: '10' })],
      pending: [
        {
          patches: [
            { op: 'replace', path: '/properties/price', value: stringField() },
          ],
          schema: draftSchema,
        },
      ],
      selectedEffects: [{ historyIndex: 1, patchIndex: 0 }],
    });

    const result = requiredProjected(await project(input));

    expect(result.draft.schema).toEqual(headSchema);
    expect(requiredProjectionRow(result.draft, 'row-1').data).toEqual({
      price: 10,
    });
  });

  it('blocks an incompatible independent Draft value after replacement discard', async () => {
    const headSchema = objectSchema({ price: numberField() });
    const draftSchema = objectSchema({ price: stringField() });
    const input = givenSchemaProjection({
      operation: 'discard',
      headSchema,
      draftSchema,
      headRows: [rowInput('row-1', { price: 10 })],
      draftRows: [rowInput('row-1', { price: 'custom' })],
      pending: [
        {
          patches: [
            { op: 'replace', path: '/properties/price', value: stringField() },
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
      path: '/price',
    });
  });

  it('restores the Head value when the caller discards an incompatible Draft value', async () => {
    const headSchema = objectSchema({ price: numberField() });
    const draftSchema = objectSchema({ price: stringField() });
    const input = givenSchemaProjection({
      operation: 'discard',
      headSchema,
      draftSchema,
      headRows: [rowInput('row-1', { price: 10 })],
      draftRows: [rowInput('row-1', { price: 'custom' })],
      pending: [
        {
          patches: [
            { op: 'replace', path: '/properties/price', value: stringField() },
          ],
          schema: draftSchema,
        },
      ],
      selectedEffects: [{ historyIndex: 1, patchIndex: 0 }],
      discardedDataFields: [{ rowCreatedId: 'row-1', path: '/price' }],
    });

    const result = requiredProjected(await project(input));

    expect(requiredProjectionRow(result.draft, 'row-1').data).toEqual({
      price: 10,
    });
  });

  it('keeps independent data under a compatible constraint replacement', async () => {
    const headSchema = objectSchema({ title: stringField() });
    const draftSchema = objectSchema({
      title: { ...stringField(), pattern: '^.*$' },
    });
    const input = givenSchemaProjection({
      operation: 'discard',
      headSchema,
      draftSchema,
      headRows: [rowInput('row-1', { title: 'Head' })],
      draftRows: [rowInput('row-1', { title: 'Independent' })],
      pending: [
        {
          patches: [
            {
              op: 'replace',
              path: '/properties/title',
              value: { ...stringField(), pattern: '^.*$' },
            },
          ],
          schema: draftSchema,
        },
      ],
      selectedEffects: [{ historyIndex: 1, patchIndex: 0 }],
    });

    const result = requiredProjected(await project(input));

    expect(result.draft.schema).toEqual(headSchema);
    expect(requiredProjectionRow(result.draft, 'row-1').data).toEqual({
      title: 'Independent',
    });
  });

  it('preserves descendant identity across a compatible object replacement', async () => {
    const headSchema = objectSchema({
      details: objectSchema({ title: stringField() }),
    });
    const replacementSchema = objectSchema({
      title: { ...stringField(), pattern: '^.*$' },
    });
    const draftSchema = objectSchema({ details: replacementSchema });
    const input = givenSchemaProjection({
      operation: 'discard',
      headSchema,
      draftSchema,
      headRows: [rowInput('row-1', { details: { title: 'Head' } })],
      draftRows: [rowInput('row-1', { details: { title: 'Independent' } })],
      pending: [
        {
          patches: [
            {
              op: 'replace',
              path: '/properties/details',
              value: replacementSchema,
            },
          ],
          schema: draftSchema,
        },
      ],
      selectedEffects: [{ historyIndex: 1, patchIndex: 0 }],
    });

    const result = requiredProjected(await project(input));

    expect(result.draft.schema).toEqual(headSchema);
    expect(requiredProjectionRow(result.draft, 'row-1').data).toEqual({
      details: { title: 'Independent' },
    });
  });

  it('keeps replacement-added children distinct from removed Head children', async () => {
    const headSchema = objectSchema({
      details: objectSchema({ title: stringField(), obsolete: stringField() }),
    });
    const replacementDetailsSchema = objectSchema({
      title: stringField(),
      added: stringField(),
    });
    const draftSchema = objectSchema({ details: replacementDetailsSchema });
    const input = givenSchemaProjection({
      operation: 'discard',
      headSchema,
      draftSchema,
      headRows: [],
      draftRows: [],
      pending: [
        {
          patches: [
            {
              op: 'replace',
              path: '/properties/details',
              value: replacementDetailsSchema,
            },
          ],
          schema: draftSchema,
        },
      ],
      selectedEffects: [{ historyIndex: 1, patchIndex: 0 }],
    });

    const result = requiredProjected(await project(input));

    expect(result.rowTargetFieldMappings).toContainEqual({
      fromPath: '/details/title',
      toPath: '/details/title',
    });
    expect(
      result.rowTargetFieldMappings.some(
        ({ fromPath }) => fromPath === '/details/added',
      ),
    ).toBe(false);
  });

  it('reports the empty JSON Pointer for an invalid root value', async () => {
    const headSchema = numberField();
    const draftSchema = stringField();
    const input = givenSchemaProjection({
      operation: 'discard',
      headSchema,
      draftSchema,
      headRows: [rowInput('row-1', 10)],
      draftRows: [rowInput('row-1', 'custom')],
      pending: [
        {
          patches: [{ op: 'replace', path: '', value: draftSchema }],
          schema: draftSchema,
        },
      ],
      selectedEffects: [{ historyIndex: 1, patchIndex: 0 }],
    });

    const result = requiredBlocked(await project(input));

    expect(requiredProjectionBlocker(result)).toMatchObject({
      code: 'UNREPRESENTABLE_REMAINDER',
      rowCreatedId: 'row-1',
      path: '',
      requiredDataFields: [{ rowCreatedId: 'row-1', path: '' }],
    });
  });

  it('uses the returned root data requirement to restore the Head value', async () => {
    const headSchema = numberField();
    const draftSchema = stringField();
    const input = givenSchemaProjection({
      operation: 'discard',
      headSchema,
      draftSchema,
      headRows: [rowInput('row-1', 10)],
      draftRows: [rowInput('row-1', 'custom')],
      pending: [
        {
          patches: [{ op: 'replace', path: '', value: draftSchema }],
          schema: draftSchema,
        },
      ],
      selectedEffects: [{ historyIndex: 1, patchIndex: 0 }],
    });
    const blockedResult = requiredBlocked(await project(input));
    const blocker = requiredProjectionBlocker(blockedResult);
    const authorizedInput = givenSchemaProjection({
      operation: 'discard',
      headSchema,
      draftSchema,
      headRows: [rowInput('row-1', 10)],
      draftRows: [rowInput('row-1', 'custom')],
      pending: [
        {
          patches: [{ op: 'replace', path: '', value: draftSchema }],
          schema: draftSchema,
        },
      ],
      selectedEffects: [{ historyIndex: 1, patchIndex: 0 }],
      discardedDataFields: blocker.requiredDataFields,
    });

    const result = requiredProjected(await project(authorizedInput));

    expect(requiredProjectionRow(result.draft, 'row-1').data).toBe(10);
  });

  it('preserves surviving child identities across a root object replacement', async () => {
    const headSchema = objectSchema({
      title: stringField(),
      obsolete: stringField(),
    });
    const draftSchema = objectSchema({
      title: stringField(),
      added: stringField(),
    });
    const input = givenSchemaProjection({
      operation: 'discard',
      headSchema,
      draftSchema,
      headRows: [],
      draftRows: [],
      pending: [
        {
          patches: [{ op: 'replace', path: '', value: draftSchema }],
          schema: draftSchema,
        },
      ],
      selectedEffects: [{ historyIndex: 1, patchIndex: 0 }],
    });

    const result = requiredProjected(await project(input));

    expect(result.rowTargetFieldMappings).toContainEqual({
      fromPath: '/title',
      toPath: '/title',
    });
    expect(
      result.rowTargetFieldMappings.some(
        ({ fromPath }) => fromPath === '/added',
      ),
    ).toBe(false);
  });

  it('reports an incompatible independent value in current Draft coordinates after separate updates', async () => {
    const headSchema = objectSchema({
      price: numberField(),
      title: stringField(),
    });
    const renamedSchema = objectSchema({
      cost: numberField(),
      title: stringField(),
    });
    const draftSchema = objectSchema({
      cost: stringField(),
      title: stringField(),
    });
    const input = givenSchemaProjection({
      operation: 'discard',
      headSchema,
      draftSchema,
      headRows: [rowInput('row-1', { price: 10, title: 'Head' })],
      draftRows: [rowInput('row-1', { cost: 'custom', title: 'Draft' })],
      pending: [
        {
          patches: [moveField('/properties/price', '/properties/cost')],
          schema: renamedSchema,
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
      ],
    });

    const result = requiredBlocked(await project(input));

    expect(requiredProjectionBlocker(result)).toMatchObject({
      code: 'UNREPRESENTABLE_REMAINDER',
      rowCreatedId: 'row-1',
      path: '/cost',
      requiredDataFields: [{ rowCreatedId: 'row-1', path: '/cost' }],
    });
  });

  it('restores Head data from returned authorization after separate updates', async () => {
    const headSchema = objectSchema({
      price: numberField(),
      title: stringField(),
    });
    const renamedSchema = objectSchema({
      cost: numberField(),
      title: stringField(),
    });
    const draftSchema = objectSchema({
      cost: stringField(),
      title: stringField(),
    });
    const options = {
      operation: 'discard' as const,
      headSchema,
      draftSchema,
      headRows: [rowInput('row-1', { price: 10, title: 'Head' })],
      draftRows: [rowInput('row-1', { cost: 'custom', title: 'Draft' })],
      pending: [
        {
          patches: [moveField('/properties/price', '/properties/cost')],
          schema: renamedSchema,
        },
        {
          patches: [
            {
              op: 'replace' as const,
              path: '/properties/cost',
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
    const blockedResult = requiredBlocked(
      await project(givenSchemaProjection(options)),
    );
    const blocker = requiredProjectionBlocker(blockedResult);
    const authorized = givenSchemaProjection({
      ...options,
      discardedDataFields: blocker.requiredDataFields,
    });

    const result = requiredProjected(await project(authorized));

    expect(requiredProjectionRow(result.draft, 'row-1').data).toEqual({
      price: 10,
      title: 'Draft',
    });
  });
});
