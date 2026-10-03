import { prepareRow } from 'src/__tests__/utils/prepareProject';
import { givenTwoFieldChanges, givenRowChanges } from '../support/row-scenario';
import { rowVersion } from '../support/persistence';
import { useChangesTestKit } from '../support/test-kit';

describe.skip('Draft Changes: persistence invariants', () => {
  const kit = useChangesTestKit();

  it('does not mutate the previous Head data', async () => {
    const f = await givenTwoFieldChanges(kit());
    await f.commitFields('/a');
    expect(await f.originalHeadRow()).toEqual({ a: 1, b: 10 });
  });

  it('creates exactly one child Draft on commit', async () => {
    const f = await givenTwoFieldChanges(kit());
    await f.commitFields('/a');
    const headId = await f.revisionId('head');
    const children = await kit().prismaService.revision.findMany({
      where: { branchId: f.initial.branchId, isDraft: true, parentId: headId },
    });
    expect(children).toHaveLength(1);
  });

  it('promotes the existing Draft revision to Head', async () => {
    const f = await givenTwoFieldChanges(kit());
    await f.commitFields('/a');
    expect(await f.revisionId('head')).toBe(f.initial.draftRevisionId);
  });

  it('does not create a historical revision for discard', async () => {
    const f = await givenTwoFieldChanges(kit());
    await f.discardFields('/a');
    expect((await f.snapshot()).revisions).toHaveLength(2);
  });

  it('reuses an unchanged row version across commit', async () => {
    const f = await givenRowChanges(kit(), { head: { a: 1 }, draft: { a: 2 } });
    const unchanged = await prepareRow({
      prismaService: kit().prismaService,
      headTableVersionId: f.initial.headTableVersionId,
      draftTableVersionId: f.initial.draftTableVersionId,
      rowId: 'unchanged',
      data: { a: 7 },
      dataDraft: { a: 7 },
      schema: await f.schema('head'),
    });
    await kit().prismaService.row.update({
      where: { versionId: unchanged.headRowVersionId },
      data: {
        tables: { connect: { versionId: f.initial.draftTableVersionId } },
      },
    });
    await kit().prismaService.row.delete({
      where: { versionId: unchanged.draftRowVersionId },
    });
    const before = await rowVersion(f, 'draft', 'unchanged');
    await f.commitFields('/a');
    expect((await rowVersion(f, 'head', 'unchanged')).versionId).toBe(
      before.versionId,
    );
  });
});
