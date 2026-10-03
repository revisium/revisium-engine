import { givenRemovedEditedField } from '../support/schema-scenarios';
import { givenSiblingSchemaChanges } from '../support/schema-scenarios';
import { givenRenamedField } from '../support/schema-scenarios';
import { include } from '../support/select';
import { useChangesTestKit } from '../support/test-kit';

describe.skip('Draft Changes: commit schema', () => {
  const kit = useChangesTestKit();

  it('publishes a selected field rename', async () => {
    const f = await givenRenamedField(kit());
    await f.apply('commit', include(f.schemaFields('/properties/cost')));
    expect(await f.schemaField('head', 'cost')).toBeDefined();
  });

  it('migrates the Head value without publishing its draft edit', async () => {
    const f = await givenRenamedField(kit());
    await f.apply('commit', include(f.schemaFields('/properties/cost')));
    expect((await f.headRow())?.cost).toBe(100);
  });

  it('preserves an independent draft value after schema commit', async () => {
    const f = await givenRenamedField(kit());
    await f.apply('commit', include(f.schemaFields('/properties/cost')));
    expect((await f.draftRow())?.cost).toBe(120);
  });

  it('publishes a renamed value using the Head field name', async () => {
    const f = await givenRenamedField(kit());
    await f.commitFields('/cost');
    expect((await f.headRow())?.price).toBe(120);
  });

  it('keeps the schema rename pending when only a value is committed', async () => {
    const f = await givenRenamedField(kit());
    await f.commitFields('/title');
    expect(await f.schemaField('head', 'cost')).toBeUndefined();
  });
  it('publishes only the selected schema field', async () => {
    const f = await givenSiblingSchemaChanges(kit());
    await f.apply('commit', include(f.schemaFields('/properties/sku')));
    expect(await f.schemaField('head', 'sku')).toBeDefined();
  });

  it('keeps an unselected schema field out of Head', async () => {
    const f = await givenSiblingSchemaChanges(kit());
    await f.apply('commit', include(f.schemaFields('/properties/sku')));
    expect(await f.schemaField('head', 'note')).toBeUndefined();
  });
  it('publishes a new field value when its schema is explicitly selected', async () => {
    const f = await givenRemovedEditedField(kit());
    await f.apply(
      'commit',
      include(f.schemaFields('/properties/extra'), f.fields('/extra')),
    );
    expect((await f.headRow())?.extra).toBe(7);
  });
});
