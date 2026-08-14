import { nanoid } from 'nanoid';
import { PreviousRowStatesFixture } from './previous-row-states.fixture';

describe('PreviousRowStates lineage', () => {
  let fixture: PreviousRowStatesFixture;

  beforeAll(async () => {
    fixture = await PreviousRowStatesFixture.create();
  });

  afterAll(async () => {
    await fixture.close();
  });

  it('follows parent ancestry across a branch without sibling or future leakage', async () => {
    const projectId = nanoid();
    const mainBranchId = await fixture.createBranch({
      projectId,
      isRoot: true,
    });
    const forkBranchId = await fixture.createBranch({ projectId });
    const tableId = nanoid();
    const tableCreatedId = nanoid();
    const rowCreatedId = nanoid();

    const root = await fixture.addState({
      branchId: mainBranchId,
      tableId,
      tableCreatedId,
      rowCreatedId,
      rowId: 'row',
      value: 'A',
      isStart: true,
    });
    const parent = await fixture.addState({
      branchId: mainBranchId,
      parentId: root.revisionId,
      tableId,
      tableCreatedId,
      rowCreatedId,
      rowId: 'row',
      value: 'B',
    });
    await fixture.addState({
      branchId: mainBranchId,
      parentId: parent.revisionId,
      tableId,
      tableCreatedId,
      rowCreatedId,
      rowId: 'row',
      value: 'SIBLING',
    });
    const selected = await fixture.addState({
      branchId: forkBranchId,
      parentId: parent.revisionId,
      tableId,
      tableCreatedId,
      rowCreatedId,
      rowId: 'row',
      value: 'C',
    });

    const beforeFuture = await fixture.execute({
      revisionId: selected.revisionId,
      tableId,
      rowId: 'row',
      first: 10,
    });
    await fixture.addState({
      branchId: forkBranchId,
      parentId: selected.revisionId,
      tableId,
      tableCreatedId,
      rowCreatedId,
      rowId: 'row',
      value: 'FUTURE',
    });
    const afterFuture = await fixture.execute({
      revisionId: selected.revisionId,
      tableId,
      rowId: 'row',
      first: 10,
    });

    expect(afterFuture).toEqual(beforeFuture);
    expect(afterFuture?.edges.map(({ node }) => node.revision.id)).toEqual([
      parent.revisionId,
      root.revisionId,
    ]);
    expect(afterFuture?.edges.map(({ node }) => node.branch.id)).toEqual([
      mainBranchId,
      mainBranchId,
    ]);
  });

  it('follows nested child to parent to parent-parent fork ancestry', async () => {
    const projectId = nanoid();
    const rootBranchId = await fixture.createBranch({
      projectId,
      isRoot: true,
    });
    const parentBranchId = await fixture.createBranch({ projectId });
    const childBranchId = await fixture.createBranch({ projectId });
    const tableId = nanoid();
    const tableCreatedId = nanoid();
    const rowCreatedId = nanoid();
    const root = await fixture.addState({
      branchId: rootBranchId,
      tableId,
      tableCreatedId,
      rowCreatedId,
      rowId: 'row',
      value: 'A',
      isStart: true,
    });
    const parent = await fixture.addState({
      branchId: parentBranchId,
      parentId: root.revisionId,
      tableId,
      tableCreatedId,
      rowCreatedId,
      rowId: 'row',
      value: 'B',
      isStart: true,
    });
    const selected = await fixture.addState({
      branchId: childBranchId,
      parentId: parent.revisionId,
      tableId,
      tableCreatedId,
      rowCreatedId,
      rowId: 'row',
      value: 'C',
      isStart: true,
    });

    const result = await fixture.execute({
      revisionId: selected.revisionId,
      tableId,
      rowId: 'row',
      first: 10,
    });

    expect(result?.edges.map(({ node }) => node.revision.id)).toEqual([
      parent.revisionId,
      root.revisionId,
    ]);
    expect(result?.edges.map(({ node }) => node.branch.id)).toEqual([
      parentBranchId,
      rootBranchId,
    ]);
  });

  it('returns null when the exact revision/table/row selector is unresolved', async () => {
    const scenario = await fixture.createLinearScenario({
      states: [{ rowId: 'row', value: 'A' }],
    });

    await expect(
      fixture.execute({
        revisionId: nanoid(),
        tableId: scenario.tableIds[0] as string,
        rowId: 'row',
        first: 10,
      }),
    ).resolves.toBeNull();
    await expect(
      fixture.execute({
        revisionId: scenario.revisionIds[0] as string,
        tableId: scenario.tableIds[0] as string,
        rowId: 'missing-row',
        first: 10,
      }),
    ).resolves.toBeNull();
  });
});
