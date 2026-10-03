import objectHash from 'object-hash';
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
  rootHistory,
  rowInput,
  stringField,
} from './support/schema-projection-fixture';

describe('Draft Changes schema projection history lineage', () => {
  it('does not treat a later added field as the identity of an earlier one when discarding', async () => {
    const headSchema = objectSchema({ title: stringField() });
    const xSchema = objectSchema({ title: stringField(), x: numberField() });
    const draftSchema = objectSchema({
      title: stringField(),
      x: numberField(),
      y: numberField(),
    });
    const input = givenSchemaProjection({
      operation: 'discard',
      headSchema,
      draftSchema,
      headRows: [rowInput('row-1', { title: 'Head' })],
      draftRows: [rowInput('row-1', { title: 'Head', x: 41, y: 0 })],
      pending: [
        {
          patches: [{ op: 'add', path: '/properties/x', value: numberField() }],
          schema: xSchema,
        },
        {
          patches: [{ op: 'add', path: '/properties/y', value: numberField() }],
          schema: draftSchema,
        },
      ],
      selectedEffects: [{ historyIndex: 1, patchIndex: 0 }],
    });

    const result = requiredBlocked(await project(input));

    expect(requiredProjectionBlocker(result)).toMatchObject({
      code: 'UNREPRESENTABLE_REMAINDER',
      path: '/x',
    });
  });

  it('keeps the original patch index when siblings share a history group', async () => {
    const headSchema = objectSchema({ title: stringField() });
    const draftSchema = objectSchema({
      title: stringField(),
      x: numberField(),
      y: numberField(),
    });
    const input = givenSchemaProjection({
      operation: 'discard',
      headSchema,
      draftSchema,
      headRows: [rowInput('row-1', { title: 'Head' })],
      draftRows: [rowInput('row-1', { title: 'Head', x: 41, y: 0 })],
      pending: [
        {
          patches: [
            { op: 'add', path: '/properties/x', value: numberField() },
            { op: 'add', path: '/properties/y', value: numberField() },
          ],
          schema: draftSchema,
        },
      ],
      selectedEffects: [{ historyIndex: 1, patchIndex: 0 }],
    });

    const result = requiredBlocked(await project(input));

    expect(requiredProjectionBlocker(result)).toMatchObject({
      code: 'UNREPRESENTABLE_REMAINDER',
      path: '/x',
    });
  });

  it('maps a selected later field to its original identity on commit', async () => {
    const headSchema = objectSchema({ title: stringField() });
    const xSchema = objectSchema({ title: stringField(), x: numberField() });
    const draftSchema = objectSchema({
      title: stringField(),
      x: numberField(),
      y: numberField(),
    });
    const input = givenSchemaProjection({
      headSchema,
      draftSchema,
      headRows: [rowInput('row-1', { title: 'Head' })],
      draftRows: [rowInput('row-1', { title: 'Head', x: 0, y: 0 })],
      pending: [
        {
          patches: [{ op: 'add', path: '/properties/x', value: numberField() }],
          schema: xSchema,
        },
        {
          patches: [{ op: 'add', path: '/properties/y', value: numberField() }],
          schema: draftSchema,
        },
      ],
      selectedEffects: [{ historyIndex: 2, patchIndex: 0 }],
    });

    const result = requiredProjected(await project(input));

    expect(result.rowTargetFieldMappings).toContainEqual({
      fromPath: '/y',
      toPath: '/y',
    });
    expect(result.rowTargetFieldMappings).not.toContainEqual({
      fromPath: '/x',
      toPath: '/y',
    });
  });

  it('maps a two-step rename chain from Draft coordinates to Head coordinates', async () => {
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
    });

    const result = requiredProjected(await project(input));

    expect(result.rowFieldMappings).toContainEqual({
      fromPath: '/amount',
      toPath: '/price',
    });
    expect(requiredProjectionRow(result.migratedHead, 'row-1').data).toEqual({
      amount: 8,
    });
  });

  it('requires complete recorded Head history records to prefix Draft history', async () => {
    const schema = objectSchema({ price: numberField() });
    const headRoot = rootHistory(schema);
    const input = givenSchemaProjection({
      headSchema: schema,
      draftSchema: schema,
      headHistory: [{ ...headRoot, date: '2026-02-01T00:00:00.000Z' }],
      draftHistory: [rootHistory(schema)],
    });

    const result = requiredBlocked(await project(input));

    expect(requiredProjectionBlocker(result).code).toBe(
      'SCHEMA_HISTORY_PREFIX_MISMATCH',
    );
  });

  it('maps nested child renames beneath a renamed parent', async () => {
    const headSchema = objectSchema({
      details: objectSchema({ title: stringField() }),
    });
    const draftSchema = objectSchema({
      profile: objectSchema({ label: stringField() }),
    });
    const input = givenSchemaProjection({
      headSchema,
      draftSchema,
      headRows: [rowInput('row-1', { details: { title: 'Head title' } })],
      draftRows: [rowInput('row-1', { profile: { label: 'Draft title' } })],
      pending: [
        {
          patches: [
            moveField('/properties/details', '/properties/profile'),
            moveField(
              '/properties/profile/properties/title',
              '/properties/profile/properties/label',
            ),
          ],
          schema: draftSchema,
        },
      ],
    });

    const result = requiredProjected(await project(input));

    expect(requiredProjectionRow(result.migratedHead, 'row-1').data).toEqual({
      profile: { label: 'Head title' },
    });
    expect(result.rowFieldMappings).toContainEqual({
      fromPath: '/profile/label',
      toPath: '/details/title',
    });
  });

  it('replays the remaining change after committing a prior rename', async () => {
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

    const first = requiredProjected(await project(input));

    expect(first.head.schema).toEqual(costSchema);
    expect(first.draft.schema).toEqual(amountSchema);
    const nextInput = givenSchemaProjection({
      headSchema: first.head.schema,
      draftSchema: first.draft.schema,
      headRows: first.head.rows,
      draftRows: first.draft.rows,
      headHistory: first.head.history,
      draftHistory: first.draft.history,
    });
    const secondInput = {
      ...nextInput,
      effects: [{ historyIndex: 2, patchIndex: 0 }],
    };

    const second = requiredProjected(await project(secondInput));
    expect(second.head.schema).toEqual(amountSchema);
  });

  it('blocks a selected later rename without its required predecessor', async () => {
    const headSchema = objectSchema({ price: numberField() });
    const costSchema = objectSchema({ cost: numberField() });
    const amountSchema = objectSchema({ amount: numberField() });
    const input = givenSchemaProjection({
      headSchema,
      draftSchema: amountSchema,
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
      selectedEffects: [{ historyIndex: 2, patchIndex: 0 }],
    });

    const result = requiredBlocked(await project(input));

    expect(requiredProjectionBlocker(result).code).toBe(
      'DEPENDENT_EFFECT_SPLIT',
    );
  });

  it('blocks when the recorded Head history is not a prefix of Draft history', async () => {
    const headSchema = objectSchema({ price: numberField() });
    const draftSchema = headSchema;
    const otherSchema = objectSchema({ title: stringField() });
    const headHistory = [rootHistory(otherSchema)];
    const draftHistory = [rootHistory(headSchema)];
    const input = givenSchemaProjection({
      headSchema: otherSchema,
      draftSchema,
      headHistory,
      draftHistory,
    });

    const result = requiredBlocked(await project(input));

    expect(requiredProjectionBlocker(result).code).toBe(
      'SCHEMA_HISTORY_PREFIX_MISMATCH',
    );
  });

  it('blocks missing recorded schema history', async () => {
    const schema = objectSchema({ name: stringField() });
    const input = givenSchemaProjection({
      headSchema: schema,
      draftSchema: schema,
      headHistory: [],
      draftHistory: [],
    });

    const result = requiredBlocked(await project(input));

    expect(requiredProjectionBlocker(result).code).toBe(
      'SCHEMA_HISTORY_MISSING',
    );
  });

  it('blocks a recorded history entry with an invalid schema hash', async () => {
    const schema = objectSchema({ name: stringField() });
    const invalidRoot = { ...rootHistory(schema), hash: 'wrong-hash' };
    const input = givenSchemaProjection({
      headSchema: schema,
      draftSchema: schema,
      headHistory: [invalidRoot],
      draftHistory: [invalidRoot],
    });

    const result = requiredBlocked(await project(input));

    expect(requiredProjectionBlocker(result).code).toBe(
      'SCHEMA_HISTORY_INVALID',
    );
  });

  it('blocks a history whose terminal schema does not match Draft', async () => {
    const headSchema = objectSchema({ price: numberField() });
    const draftSchema = objectSchema({ cost: numberField() });
    const terminalSchema = objectSchema({ amount: numberField() });
    const input = givenSchemaProjection({
      headSchema,
      draftSchema,
      pending: [
        {
          patches: [moveField('/properties/price', '/properties/amount')],
          schema: terminalSchema,
        },
      ],
    });

    const result = requiredBlocked(await project(input));

    expect(requiredProjectionBlocker(result).code).toBe(
      'SCHEMA_PROVENANCE_MISMATCH',
    );
  });

  it('recomputes the schema hash using the engine object-hash convention', async () => {
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
      selectedEffects: [{ historyIndex: 1, patchIndex: 0 }],
    });

    const result = requiredProjected(await project(input));

    expect(result.head.history.at(-1)?.hash).toBe(
      objectHash(result.head.schema),
    );
    expect(result.head.history.at(-1)?.date).toBe('2026-01-01T00:00:00.000Z');
  });
});
