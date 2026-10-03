import { BadRequestException } from '@nestjs/common';
import { givenTwoFieldChanges, givenRowChanges } from '../support/row-scenario';
import { useChangesTestKit } from '../support/test-kit';

describe.skip('Draft Changes: pagination', () => {
  const kit = useChangesTestKit();

  it('limits row change details to the requested page size', async () => {
    const f = await givenTwoFieldChanges(kit());
    const page = await f.rowChanges({ first: 1 });
    expect(page.changes).toHaveLength(1);
  });

  it('continues row change details without repeating a ref', async () => {
    const f = await givenTwoFieldChanges(kit());
    const first = await f.rowChanges({ first: 1 });
    const second = await f.rowChanges({
      first: 1,
      after: first.pageInfo.endCursor ?? undefined,
    });
    expect(second.changes[0]?.ref.value).not.toBe(first.changes[0]?.ref.value);
  });

  it('rejects a cursor after a Draft write', async () => {
    const f = await givenTwoFieldChanges(kit());
    const first = await f.rowChanges({ first: 1 });
    await f.updateDraftRow({ a: 3, b: 20 });
    await expect(
      f.rowChanges({ first: 1, after: first.pageInfo.endCursor ?? undefined }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reports no further page after the last field', async () => {
    const f = await givenTwoFieldChanges(kit());
    expect((await f.rowChanges({ first: 100 })).pageInfo.hasNextPage).toBe(
      false,
    );
  });

  it('bounds the refs attached to a browsed row', async () => {
    const head = Object.fromEntries(
      Array.from({ length: 101 }, (_, i) => [`f${i}`, 0]),
    );
    const draft = Object.fromEntries(
      Array.from({ length: 101 }, (_, i) => [`f${i}`, 1]),
    );
    const f = await givenRowChanges(kit(), { head, draft });
    expect(
      (await f.browseRows()).edges[0]?.node.refs.length,
    ).toBeLessThanOrEqual(100);
  });
});
