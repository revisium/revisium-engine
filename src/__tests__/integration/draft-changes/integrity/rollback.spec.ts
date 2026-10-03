import { givenTwoFieldChanges } from '../support/row-scenario';
import { givenRemovedFile } from '../support/file-scenarios';
import {
  withFailureAfterWrite,
  withFailureBeforeReceipt,
} from '../support/failures';
import { persistedState } from '../support/persistence';
import { useChangesTestKit } from '../support/test-kit';

describe.skip('Draft Changes: atomic rollback', () => {
  const kit = useChangesTestKit();

  it('rolls back all persisted state after a writer failure', async () => {
    const f = await givenTwoFieldChanges(kit());
    const before = await persistedState(f);
    await withFailureAfterWrite(kit(), () => f.commitFields('/a'));
    expect(await persistedState(f)).toEqual(before);
  });

  it('rolls back mutation when receipt persistence cannot be reached', async () => {
    const f = await givenTwoFieldChanges(kit());
    const before = await persistedState(f);
    await withFailureBeforeReceipt(kit(), () => f.commitFields('/a'));
    expect(await persistedState(f)).toEqual(before);
  });

  it('rolls back file associations and accounting with the row mutation', async () => {
    const { f } = await givenRemovedFile(kit());
    const before = await persistedState(f);
    await withFailureBeforeReceipt(kit(), () => f.discardFields('/attachment'));
    expect(await persistedState(f)).toEqual(before);
  });
});
