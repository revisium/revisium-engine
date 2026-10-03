import hash from 'object-hash';
import {
  tamperSchemaWithoutHistory,
  tamperRowHash,
} from '../support/corruption';
import { rowVersion } from '../support/persistence';
import { givenRowChanges } from '../support/row-scenario';
import { useChangesTestKit } from '../support/test-kit';

describe.skip('Draft Changes: invalid Draft repair', () => {
  const kit = useChangesTestKit();

  it('blocks commit of invalid stored Draft data', async () => {
    const f = await givenRowChanges(kit(), { head: { a: 1 }, draft: { a: 2 } });
    await f.tamperDraftRow({ a: 'invalid' });
    expect((await f.plan('commit')).status).toBe('blocked');
  });

  it('restores valid Head data on full discard', async () => {
    const f = await givenRowChanges(kit(), { head: { a: 1 }, draft: { a: 2 } });
    await f.tamperDraftRow({ a: 'invalid' });
    await f.discardAll();
    expect(await f.draftRow()).toEqual({ a: 1 });
  });

  it('repairs a selected invalid field without discarding another valid edit', async () => {
    const f = await givenRowChanges(kit(), {
      head: { a: 1, b: 10 },
      draft: { a: 2, b: 20 },
    });
    await f.tamperDraftRow({ a: 'invalid', b: 20 });
    await f.discardFields('/a');
    expect((await f.draftRow())?.b).toBe(20);
  });
  it('restores the valid Head schema on full discard', async () => {
    const f = await givenRowChanges(kit(), { head: { a: 1 }, draft: { a: 2 } });
    const originalSchema = await f.schema('head');
    await tamperSchemaWithoutHistory(f, {
      type: 'object',
      additionalProperties: false,
      required: ['a'],
      properties: { a: { type: 'unsupported-type' } },
    });
    await f.discardAll();
    expect(await f.schema('draft')).toEqual(originalSchema);
  });

  it('repairs a stored hash even when user values are unchanged', async () => {
    const f = await givenRowChanges(kit(), { head: { a: 1 }, draft: { a: 1 } });
    await tamperRowHash(f);
    await f.discardAll();
    expect((await rowVersion(f, 'draft')).hash).toBe(hash({ a: 1 }));
  });
});
