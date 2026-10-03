import {
  givenTwoFieldChanges,
  type RowChangesScenario,
} from '../support/row-scenario';
import { useChangesTestKit } from '../support/test-kit';

describe.skip('Draft Changes: commit values', () => {
  const kit = useChangesTestKit();
  let f: RowChangesScenario;

  it('publishes the selected field', async () => {
    await f.commitFields('/a');
    expect((await f.headRow())?.a).toBe(2);
  });

  it('keeps an unselected field unpublished', async () => {
    await f.commitFields('/a');
    expect((await f.headRow())?.b).toBe(10);
  });

  it('preserves an unselected draft edit', async () => {
    await f.commitFields('/a');
    expect((await f.draftRow())?.b).toBe(20);
  });

  it('publishes all changed values for a full commit', async () => {
    await f.commitAll();
    expect(await f.headRow()).toEqual({ a: 2, b: 20 });
  });

  it('leaves no pending changes after a full commit', async () => {
    await f.commitAll();
    expect((await kit().changes.draftChanges(f.branch)).isEmpty).toBe(true);
  });

  beforeEach(async () => {
    f = await givenTwoFieldChanges(kit());
  });
});
