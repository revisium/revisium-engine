import { nanoid } from 'nanoid';
import { PluginService } from 'src/features/plugin/plugin.service';
import { PreviousRowStatesFixture } from './previous-row-states.fixture';

describe('PreviousRowStates states', () => {
  let fixture: PreviousRowStatesFixture;

  beforeAll(async () => {
    fixture = await PreviousRowStatesFixture.create();
  });

  afterAll(async () => {
    await fixture.close();
  });

  it('returns an empty connection when the selected state is its creation', async () => {
    const scenario = await fixture.createLinearScenario({
      states: [{ rowId: 'row', value: 'A' }],
    });

    const result = await fixture.execute({
      revisionId: scenario.revisionIds[0] as string,
      tableId: scenario.tableId,
      rowId: 'row',
      first: 10,
    });

    expect(result).toEqual({
      edges: [],
      totalCount: 0,
      pageInfo: {
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });
  });

  it('returns an empty connection when the selected state creates a row mid-lineage', async () => {
    const projectId = nanoid();
    const branchId = await fixture.createBranch({ projectId, isRoot: true });
    const tableId = nanoid();
    const tableCreatedId = nanoid();
    const rowCreatedId = nanoid();
    const beforeCreation = await fixture.addTableOnlyState({
      branchId,
      tableId,
      tableCreatedId,
      isStart: true,
    });
    const creation = await fixture.addState({
      branchId,
      parentId: beforeCreation.revisionId,
      tableId,
      tableCreatedId,
      rowCreatedId,
      rowId: 'row',
      value: 'A',
    });

    const result = await fixture.execute({
      revisionId: creation.revisionId,
      tableId,
      rowId: 'row',
      first: 10,
    });

    expect(result).toEqual({
      edges: [],
      totalCount: 0,
      pageInfo: {
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });
  });

  it('finds creation after older committed revisions without the row', async () => {
    const projectId = nanoid();
    const branchId = await fixture.createBranch({ projectId, isRoot: true });
    const tableId = nanoid();
    const tableCreatedId = nanoid();
    const rowCreatedId = nanoid();
    const oldest = await fixture.addTableOnlyState({
      branchId,
      tableId,
      tableCreatedId,
      isStart: true,
    });
    const beforeCreation = await fixture.addTableOnlyState({
      branchId,
      parentId: oldest.revisionId,
      tableId,
      tableCreatedId,
    });
    const creation = await fixture.addState({
      branchId,
      parentId: beforeCreation.revisionId,
      tableId,
      tableCreatedId,
      rowCreatedId,
      rowId: 'row',
      value: 'A',
    });
    const selected = await fixture.addState({
      branchId,
      parentId: creation.revisionId,
      tableId,
      tableCreatedId,
      rowCreatedId,
      rowId: 'row',
      value: 'B',
    });

    const result = await fixture.execute({
      revisionId: selected.revisionId,
      tableId,
      rowId: 'row',
      first: 10,
    });

    expect(result?.edges).toHaveLength(1);
    expect(result?.edges[0]?.node).toMatchObject({
      row: { id: 'row', data: { value: 'A' } },
      revision: { id: creation.revisionId },
      introducedBy: ['created'],
    });
  });

  it('returns the previous first-effective persisted state with context', async () => {
    const scenario = await fixture.createLinearScenario({
      states: [
        { rowId: 'row', value: 'A' },
        { rowId: 'row', value: 'B' },
      ],
    });

    const result = await fixture.execute({
      revisionId: scenario.revisionIds[1] as string,
      tableId: scenario.tableId,
      rowId: 'row',
      first: 10,
    });

    expect(result?.totalCount).toBe(1);
    expect(result?.pageInfo).toEqual({
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: expect.any(String),
      endCursor: expect.any(String),
    });
    expect(result?.edges).toHaveLength(1);
    expect(result?.edges[0]?.node).toMatchObject({
      row: { id: 'row', data: { value: 'A' } },
      table: { id: scenario.tableId },
      revision: { id: scenario.revisionIds[0] },
      branch: { id: scenario.branchId, projectId: scenario.projectId },
      introducedBy: ['created'],
    });
  });

  it('collapses row and table copy-on-write no-ops', async () => {
    const scenario = await fixture.createLinearScenario({
      states: [
        { rowId: 'row', value: 'A' },
        { rowId: 'row', value: 'B' },
        { rowId: 'row', value: 'B' },
      ],
    });

    const result = await fixture.executeSelected({ scenario, rowId: 'row' });

    expect(fixture.projectStates({ result, scenario })).toEqual([
      { value: 'A', rowId: 'row', revisionIndex: 0, introducedBy: ['created'] },
    ]);
  });

  it('keeps the pre-rename state after A to B to rename C', async () => {
    const scenario = await fixture.createLinearScenario({
      states: [
        { rowId: 'row', value: 'A' },
        { rowId: 'row', value: 'B' },
        { rowId: 'row-c', value: 'B' },
      ],
    });

    const result = await fixture.executeSelected({
      scenario,
      rowId: 'row-c',
    });

    expect(fixture.projectStates({ result, scenario })).toEqual([
      {
        value: 'B',
        rowId: 'row',
        revisionIndex: 1,
        introducedBy: ['modified'],
      },
      { value: 'A', rowId: 'row', revisionIndex: 0, introducedBy: ['created'] },
    ]);
  });

  it('classifies rename plus modification from direct parent to node', async () => {
    const scenario = await fixture.createLinearScenario({
      states: [
        { rowId: 'row', value: 'A' },
        { rowId: 'row-b', value: 'B' },
        { rowId: 'row-b', value: 'C' },
      ],
    });

    const result = await fixture.executeSelected({
      scenario,
      rowId: 'row-b',
    });

    expect(fixture.projectStates({ result, scenario })).toEqual([
      {
        value: 'B',
        rowId: 'row-b',
        revisionIndex: 1,
        introducedBy: ['renamed', 'modified'],
      },
      { value: 'A', rowId: 'row', revisionIndex: 0, introducedBy: ['created'] },
    ]);
  });

  it('classifies a renamed-only previous event', async () => {
    const scenario = await fixture.createLinearScenario({
      states: [
        { rowId: 'row', value: 'A' },
        { rowId: 'renamed-row', value: 'A' },
        { rowId: 'renamed-row', value: 'B' },
      ],
    });

    const result = await fixture.executeSelected({
      scenario,
      rowId: 'renamed-row',
    });

    expect(fixture.projectStates({ result, scenario })).toEqual([
      {
        value: 'A',
        rowId: 'renamed-row',
        revisionIndex: 1,
        introducedBy: ['renamed'],
      },
      { value: 'A', rowId: 'row', revisionIndex: 0, introducedBy: ['created'] },
    ]);
  });

  it('keeps non-adjacent A to B to A reversion events', async () => {
    const scenario = await fixture.createLinearScenario({
      states: [
        { rowId: 'row', value: 'A' },
        { rowId: 'row', value: 'B' },
        { rowId: 'row', value: 'A' },
      ],
    });

    const result = await fixture.executeSelected({ scenario, rowId: 'row' });

    expect(fixture.projectStates({ result, scenario })).toEqual([
      {
        value: 'B',
        rowId: 'row',
        revisionIndex: 1,
        introducedBy: ['modified'],
      },
      { value: 'A', rowId: 'row', revisionIndex: 0, introducedBy: ['created'] },
    ]);
  });

  it('keeps table rename continuity without creating a row event', async () => {
    const scenario = await fixture.createLinearScenario({
      states: [
        { rowId: 'row', value: 'A', tableId: 'old-table' },
        { rowId: 'row', value: 'A', tableId: 'renamed-table' },
      ],
    });

    const result = await fixture.executeSelected({ scenario, rowId: 'row' });

    expect(result?.edges).toEqual([]);
    expect(result?.totalCount).toBe(0);
  });

  it('does not emit state for excluded persisted metadata changes', async () => {
    const scenario = await fixture.createLinearScenario({
      states: [
        { rowId: 'row', value: 'A' },
        { rowId: 'row', value: 'A' },
      ],
    });
    await fixture.prisma.row.update({
      where: { versionId: scenario.rowVersionIds[1] as string },
      data: {
        meta: { changed: true },
        schemaHash: 'different-schema',
        publishedAt: new Date('2026-08-14T00:00:00.000Z'),
        readonly: true,
      },
    });

    const result = await fixture.executeSelected({ scenario, rowId: 'row' });

    expect(result?.edges).toEqual([]);
    expect(result?.totalCount).toBe(0);
  });

  it('does not let unrelated Table copy-on-write create a row event', async () => {
    const scenario = await fixture.createLinearScenario({
      states: [
        { rowId: 'row', value: 'A' },
        { rowId: 'row', value: 'A' },
      ],
    });
    const unrelatedCreatedId = nanoid();
    for (const [index, revisionId] of scenario.revisionIds.entries()) {
      await fixture.prisma.table.create({
        data: {
          id: `unrelated-${index}`,
          createdId: unrelatedCreatedId,
          versionId: nanoid(),
          revisions: { connect: { id: revisionId } },
        },
      });
    }

    const result = await fixture.executeSelected({ scenario, rowId: 'row' });

    expect(result?.edges).toEqual([]);
    expect(result?.totalCount).toBe(0);
  });

  it('isolates reuse of a row id with a new stable createdId', async () => {
    const scenario = await fixture.createLinearScenario({
      states: [
        { rowId: 'row', value: 'OLD' },
        { rowId: 'row', value: 'NEW', newRowIdentity: true },
      ],
    });

    const result = await fixture.executeSelected({ scenario, rowId: 'row' });

    expect(result?.edges).toEqual([]);
    expect(result?.totalCount).toBe(0);
  });

  it('hydrates valid persisted empty hash fields without plugin computation', async () => {
    const scenario = await fixture.createLinearScenario({
      states: [
        { rowId: 'row', value: 'A' },
        { rowId: 'row', value: 'B' },
      ],
    });
    await fixture.prisma.row.update({
      where: { versionId: scenario.rowVersionIds[0] as string },
      data: { hash: '', schemaHash: '' },
    });

    const plugin = fixture.module.get(PluginService);
    const computeRows = jest.spyOn(plugin, 'computeRows');

    const result = await fixture.executeSelected({ scenario, rowId: 'row' });

    expect(result?.edges[0]?.node.row).toMatchObject({
      hash: '',
      schemaHash: '',
      data: { value: 'A' },
    });
    expect(computeRows).not.toHaveBeenCalled();
    computeRows.mockRestore();
  });
});
