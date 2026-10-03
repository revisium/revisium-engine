import {
  givenTwoFieldChanges,
  type RowChangesScenario,
} from '../support/row-scenario';
import { useChangesTestKit } from '../support/test-kit';

describe.skip('Draft Changes: discard values', () => {
  const kit = useChangesTestKit();
  let f: RowChangesScenario;

  it('restores the selected draft field from Head', async () => {
    await f.discardFields('/a');
    expect((await f.draftRow())?.a).toBe(1);
  });

  it('preserves an unselected draft edit', async () => {
    await f.discardFields('/a');
    expect((await f.draftRow())?.b).toBe(20);
  });

  it('preserves Head during partial discard', async () => {
    await f.discardFields('/a');
    expect(await f.headRow()).toEqual({ a: 1, b: 10 });
  });

  it('restores all draft values for a full discard', async () => {
    await f.discardAll();
    expect(await f.draftRow()).toEqual({ a: 1, b: 10 });
  });

  it('leaves no pending changes after a full discard', async () => {
    await f.discardAll();
    expect((await kit().changes.draftChanges(f.branch)).isEmpty).toBe(true);
  });

  beforeEach(async () => {
    f = await givenTwoFieldChanges(kit());
  });
});
