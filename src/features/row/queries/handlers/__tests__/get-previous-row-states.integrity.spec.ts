import { BadRequestException } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { PreviousRowStatesFixture } from './previous-row-states.fixture';

describe('PreviousRowStates integrity', () => {
  let fixture: PreviousRowStatesFixture;

  beforeAll(async () => {
    fixture = await PreviousRowStatesFixture.create();
  });

  afterAll(async () => {
    await fixture.close();
  });

  it('rejects a Draft selected revision', async () => {
    const scenario = await fixture.createLinearScenario({
      states: [{ rowId: 'row', value: 'A' }],
    });
    await fixture.prisma.revision.update({
      where: { id: scenario.revisionIds[0] as string },
      data: { isDraft: true },
    });

    await expect(
      fixture.executeSelected({ scenario, rowId: 'row' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a Draft revision inside committed ancestry', async () => {
    const scenario = await fixture.createLinearScenario({
      states: [
        { rowId: 'row', value: 'A' },
        { rowId: 'row', value: 'B' },
        { rowId: 'row', value: 'C' },
      ],
    });
    await fixture.prisma.revision.update({
      where: { id: scenario.revisionIds[1] as string },
      data: { isDraft: true },
    });

    await expect(
      fixture.executeSelected({ scenario, rowId: 'row' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a broken non-start ancestry gap', async () => {
    const scenario = await fixture.createLinearScenario({
      states: [{ rowId: 'row', value: 'A' }],
    });
    await fixture.prisma.revision.update({
      where: { id: scenario.revisionIds[0] as string },
      data: { isStart: false },
    });

    await expect(
      fixture.executeSelected({ scenario, rowId: 'row' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a valid root start when Branch.isRoot is false', async () => {
    const scenario = await fixture.createLinearScenario({
      states: [
        { rowId: 'row', value: 'A' },
        { rowId: 'row', value: 'B' },
      ],
    });
    await fixture.prisma.branch.update({
      where: { id: scenario.branchId },
      data: { isRoot: false },
    });

    const result = await fixture.executeSelected({
      scenario,
      rowId: 'row',
    });

    expect(fixture.projectStates({ result, scenario })).toEqual([
      { value: 'A', rowId: 'row', revisionIndex: 0, introducedBy: ['created'] },
    ]);
  });

  it('rejects a non-root fork start whose parent link is missing', async () => {
    const projectId = nanoid();
    const rootBranchId = await fixture.createBranch({
      projectId,
      isRoot: true,
    });
    const forkBranchId = await fixture.createBranch({ projectId });
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
    const forkStart = await fixture.addState({
      branchId: forkBranchId,
      parentId: root.revisionId,
      tableId,
      tableCreatedId,
      rowCreatedId,
      rowId: 'row',
      value: 'B',
      isStart: true,
    });
    const selected = await fixture.addState({
      branchId: forkBranchId,
      parentId: forkStart.revisionId,
      tableId,
      tableCreatedId,
      rowCreatedId,
      rowId: 'row',
      value: 'C',
    });
    await fixture.prisma.revision.update({
      where: { id: forkStart.revisionId },
      data: { parentId: null },
    });

    await expect(
      fixture.execute({
        revisionId: selected.revisionId,
        tableId,
        rowId: 'row',
        first: 10,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a cycle in the selected parent ancestry', async () => {
    const scenario = await fixture.createLinearScenario({
      states: [
        { rowId: 'row', value: 'A' },
        { rowId: 'row', value: 'B' },
      ],
    });
    await fixture.prisma.revision.update({
      where: { id: scenario.revisionIds[0] as string },
      data: { parentId: scenario.revisionIds[1] },
    });

    await expect(
      fixture.executeSelected({ scenario, rowId: 'row' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects ancestry crossing a Project boundary', async () => {
    const ancestorBranchId = await fixture.createBranch({
      projectId: nanoid(),
    });
    const selectedBranchId = await fixture.createBranch({
      projectId: nanoid(),
    });
    const tableId = nanoid();
    const tableCreatedId = nanoid();
    const rowCreatedId = nanoid();
    const root = await fixture.addState({
      branchId: ancestorBranchId,
      tableId,
      tableCreatedId,
      rowCreatedId,
      rowId: 'row',
      value: 'A',
      isStart: true,
    });
    const selected = await fixture.addState({
      branchId: selectedBranchId,
      parentId: root.revisionId,
      tableId,
      tableCreatedId,
      rowCreatedId,
      rowId: 'row',
      value: 'B',
    });

    await expect(
      fixture.execute({
        revisionId: selected.revisionId,
        tableId,
        rowId: 'row',
        first: 10,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects duplicate logical Table and Row states', async () => {
    const duplicateTableScenario = await fixture.createLinearScenario({
      states: [
        { rowId: 'row', value: 'A' },
        { rowId: 'row', value: 'B' },
      ],
    });
    await fixture.prisma.table.create({
      data: {
        id: 'duplicate-table-id',
        createdId: duplicateTableScenario.tableCreatedId,
        versionId: nanoid(),
        revisions: {
          connect: { id: duplicateTableScenario.revisionIds[0] as string },
        },
      },
    });
    await expect(
      fixture.executeSelected({
        scenario: duplicateTableScenario,
        rowId: 'row',
      }),
    ).rejects.toThrow(BadRequestException);

    const duplicateRowScenario = await fixture.createLinearScenario({
      states: [
        { rowId: 'row', value: 'A' },
        { rowId: 'row', value: 'B' },
      ],
    });
    await fixture.prisma.row.create({
      data: {
        id: 'duplicate-row-id',
        createdId: duplicateRowScenario.rowCreatedId,
        versionId: nanoid(),
        data: { value: 'duplicate' },
        hash: 'duplicate',
        schemaHash: 'test-schema',
        tables: {
          connect: {
            versionId: duplicateRowScenario.tableVersionIds[0] as string,
          },
        },
      },
    });
    await expect(
      fixture.executeSelected({
        scenario: duplicateRowScenario,
        rowId: 'row',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects disappearance and older reappearance of one stable Row identity', async () => {
    const projectId = nanoid();
    const branchId = await fixture.createBranch({ projectId });
    const tableId = nanoid();
    const tableCreatedId = nanoid();
    const rowCreatedId = nanoid();
    const root = await fixture.addState({
      branchId,
      tableId,
      tableCreatedId,
      rowCreatedId,
      rowId: 'row',
      value: 'A',
      isStart: true,
    });
    const absent = await fixture.addTableOnlyState({
      branchId,
      parentId: root.revisionId,
      tableId,
      tableCreatedId,
    });
    const selected = await fixture.addState({
      branchId,
      parentId: absent.revisionId,
      tableId,
      tableCreatedId,
      rowCreatedId,
      rowId: 'row',
      value: 'B',
    });

    await expect(
      fixture.execute({
        revisionId: selected.revisionId,
        tableId,
        rowId: 'row',
        first: 10,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
