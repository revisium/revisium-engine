import { givenSiblingSchemaChanges } from '../support/schema-scenarios';
import { replayedSchema } from '../support/schema-history';
import { tamperSchemaWithoutHistory } from '../support/corruption';
import { givenRowChanges } from '../support/row-scenario';
import { givenRenamedField } from '../support/schema-scenarios';
import { include } from '../support/select';
import { useChangesTestKit } from '../support/test-kit';

describe.skip('Draft Changes: migration lineage', () => {
  const kit = useChangesTestKit();

  it('maps a value through a chain of field renames', async () => {
    const f = await givenRenamedField(kit());
    await f.patchSchema([
      { op: 'move', from: '/properties/cost', path: '/properties/amount' },
    ]);
    await f.commitFields('/amount');
    expect((await f.headRow())?.price).toBe(120);
  });

  it('preserves the terminal Draft schema when publishing a renamed value', async () => {
    const f = await givenRenamedField(kit());
    await f.patchSchema([
      { op: 'move', from: '/properties/cost', path: '/properties/amount' },
    ]);
    await f.commitFields('/amount');
    expect(await f.schemaField('draft', 'amount')).toBeDefined();
  });

  it('allows a second commit of the remaining independent value', async () => {
    const f = await givenRenamedField(kit());
    await f.apply('commit', include(f.schemaFields()));
    await f.commitFields('/title');
    expect((await f.headRow())?.title).toBe('B');
  });

  it('allows a later commit after discarding the schema rename', async () => {
    const f = await givenRenamedField(kit());
    await f.apply('discard', include(f.schemaFields()));
    await f.commitFields('/price');
    expect((await f.headRow())?.price).toBe(120);
  });
  it('exports a replayable residual schema history after partial commit', async () => {
    const f = await givenSiblingSchemaChanges(kit());
    await f.apply('commit', include(f.schemaFields('/properties/sku')));
    expect(await replayedSchema(f, 'draft')).toEqual(await f.schema('draft'));
  });

  it('exports a replayable Head schema history after partial commit', async () => {
    const f = await givenSiblingSchemaChanges(kit());
    await f.apply('commit', include(f.schemaFields('/properties/sku')));
    expect(await replayedSchema(f, 'head')).toEqual(await f.schema('head'));
  });

  it('blocks partial schema discard without recorded lineage', async () => {
    const f = await givenRowChanges(kit(), { head: { a: 1 }, draft: { a: 2 } });
    await tamperSchemaWithoutHistory(f, {
      type: 'object',
      additionalProperties: false,
      required: ['a'],
      properties: { a: { type: 'unsupported-type' } },
    });
    expect((await f.plan('discard', include(f.schemaFields()))).status).toBe(
      'blocked',
    );
  });
});
