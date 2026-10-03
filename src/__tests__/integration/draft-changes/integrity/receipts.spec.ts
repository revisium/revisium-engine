import { apiErrorCode } from '../support/api-errors';
import { nanoid } from 'nanoid';
import { givenTwoFieldChanges } from '../support/row-scenario';
import { include } from '../support/select';
import { useChangesTestKit } from '../support/test-kit';

describe.skip('Draft Changes: execution replay', () => {
  const kit = useChangesTestKit();

  it('replays an identical request', async () => {
    const f = await givenTwoFieldChanges(kit());
    const plan = await f.plan('commit', include(f.fields('/a')));
    const requestId = nanoid();
    await f.execute(plan, { requestId });
    expect((await f.execute(plan, { requestId })).status).toBe('replayed');
  });

  it('returns the original result revision on replay', async () => {
    const f = await givenTwoFieldChanges(kit());
    const plan = await f.plan('commit', include(f.fields('/a')));
    const requestId = nanoid();
    const original = await f.execute(plan, { requestId });
    const replay = await f.execute(plan, { requestId });
    expect(replay.headRevisionId).toBe(original.headRevisionId);
  });

  it('does not publish another revision when a response is retried', async () => {
    const f = await givenTwoFieldChanges(kit());
    const plan = await f.plan('commit', include(f.fields('/a')));
    const requestId = nanoid();
    await f.execute(plan, { requestId });
    const before = await f.snapshot();
    await f.execute(plan, { requestId });
    expect(await f.snapshot()).toEqual(before);
  });

  it('rejects a reused requestId with a different message', async () => {
    const f = await givenTwoFieldChanges(kit());
    const plan = await f.plan('commit', include(f.fields('/a')));
    const requestId = nanoid();
    await f.execute(plan, { requestId, message: 'first' });
    expect(
      await apiErrorCode(() =>
        f.execute(plan, { requestId, message: 'second' }),
      ),
    ).toBe('REQUEST_ID_REUSED');
  });
});
