import { givenSiblingSchemaChanges } from '../support/schema-scenarios';
import {
  givenRenamedField,
  givenRemovedEditedField,
} from '../support/schema-scenarios';
import { include } from '../support/select';
import { useChangesTestKit } from '../support/test-kit';

describe.skip('Draft Changes: discard schema', () => {
  const kit = useChangesTestKit();

  it('restores the original field name', async () => {
    const f = await givenRenamedField(kit());
    await f.apply('discard', include(f.schemaFields()));
    expect(await f.schemaField('draft', 'price')).toBeDefined();
  });

  it('preserves an independent value through reverse migration', async () => {
    const f = await givenRenamedField(kit());
    await f.apply('discard', include(f.schemaFields()));
    expect((await f.draftRow())?.price).toBe(120);
  });

  it('preserves an unrelated draft field', async () => {
    const f = await givenRenamedField(kit());
    await f.apply('discard', include(f.schemaFields()));
    expect((await f.draftRow())?.title).toBe('B');
  });

  it('requires confirmation before losing an independent added-field value', async () => {
    const f = await givenRemovedEditedField(kit());
    const plan = await f.plan(
      'discard',
      include(f.schemaFields('/properties/extra')),
    );
    expect(plan.status).toBe('confirmationRequired');
  });

  it('does not apply a destructive plan without confirmation', async () => {
    const f = await givenRemovedEditedField(kit());
    const plan = await f.plan(
      'discard',
      include(f.schemaFields('/properties/extra')),
    );
    const result = await f.execute(plan);
    expect(result.status).toBe('blocked');
  });

  it('removes the added field after explicit confirmation', async () => {
    const f = await givenRemovedEditedField(kit());
    const plan = await f.plan(
      'discard',
      include(f.schemaFields('/properties/extra')),
    );
    await f.execute(plan, {
      requiredAcknowledgmentToken: plan.requiredAcknowledgmentToken,
    });
    expect(await f.schemaField('draft', 'extra')).toBeUndefined();
  });
  it('discards only the selected schema field', async () => {
    const f = await givenSiblingSchemaChanges(kit());
    await f.apply('discard', include(f.schemaFields('/properties/sku')));
    expect(await f.schemaField('draft', 'sku')).toBeUndefined();
  });

  it('preserves an unselected schema field on partial discard', async () => {
    const f = await givenSiblingSchemaChanges(kit());
    await f.apply('discard', include(f.schemaFields('/properties/sku')));
    expect(await f.schemaField('draft', 'note')).toBeDefined();
  });
});
