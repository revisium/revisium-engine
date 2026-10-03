import type { JsonSchema } from '@revisium/schema-toolkit/types';
import {
  getObjectSchema,
  getNumberSchema,
} from '@revisium/schema-toolkit/mocks';
import { givenRowChanges } from '../support/row-scenario';
import { include } from '../support/select';
import { useChangesTestKit } from '../support/test-kit';

describe.skip('Draft Changes: JSON values', () => {
  const kit = useChangesTestKit();

  it.each([
    { head: true, draft: false },
    { head: 1, draft: 0 },
    { head: 'before', draft: '' },
  ])('publishes a falsy value $draft', async ({ head, draft }) => {
    const f = await givenRowChanges(kit(), {
      head: { value: head },
      draft: { value: draft },
    });
    await f.commitFields('/value');
    expect((await f.headRow())?.value).toBe(draft);
  });

  it('selects a nested field without publishing its sibling', async () => {
    const f = await givenRowChanges(kit(), {
      head: { obj: { a: 1, b: 10 } },
      draft: { obj: { a: 2, b: 20 } },
    });
    await f.commitFields('/obj/a');
    expect((await f.headRow())?.obj).toEqual({ a: 2, b: 10 });
  });

  it('resolves an escaped JSON Pointer segment', async () => {
    const f = await givenRowChanges(kit(), {
      head: { 'a/b~c': 1 },
      draft: { 'a/b~c': 2 },
    });
    await f.commitFields('/a~1b~0c');
    expect((await f.headRow())?.['a/b~c']).toBe(2);
  });

  it('publishes an array as a whole value', async () => {
    const f = await givenRowChanges(kit(), {
      head: { values: [1] },
      draft: { values: [2, 3] },
    });
    await f.commitFields('/values');
    expect((await f.headRow())?.values).toEqual([2, 3]);
  });

  it('blocks selection of an individual array item', async () => {
    const f = await givenRowChanges(kit(), {
      head: { values: [1] },
      draft: { values: [2] },
    });
    const plan = await f.plan('commit', include(f.fields('/values/0')));
    expect(plan.status).toBe('blocked');
  });

  it('materializes null using the ordinary schema default', async () => {
    const f = await givenRowChanges(kit(), {
      head: { value: 1 },
      draft: { value: null },
      schema: getObjectSchema({ value: getNumberSchema() }),
    });
    await f.commitFields('/value');
    expect((await f.headRow())?.value).toBe(0);
  });
  it('publishes removal of an optional property', async () => {
    const schema = {
      type: 'object',
      properties: { value: { type: 'string', default: '' } },
      required: [],
      additionalProperties: false,
    } as JsonSchema;
    const f = await givenRowChanges(kit(), {
      schema,
      head: { value: 'before' },
      draft: {},
    });
    await f.commitFields('/value');
    expect(await f.headRow()).not.toHaveProperty('value');
  });

  it('reports absence separately from an existing null value', async () => {
    const schema = {
      type: 'object',
      properties: { value: { type: 'string', default: '' } },
      required: [],
      additionalProperties: false,
    } as JsonSchema;
    const f = await givenRowChanges(kit(), {
      schema,
      head: { value: 'before' },
      draft: {},
    });
    const details = await f.rowChanges();
    expect(details.changes[0]?.effect?.afterExists).toBe(false);
  });
});
