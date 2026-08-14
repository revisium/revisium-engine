import { BadRequestException } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { nanoid } from 'nanoid';
import { createQueryTestKit } from 'src/__tests__/kit/create-query-test-kit';
import type { QueryTestKit } from 'src/__tests__/kit/create-query-test-kit';
import { EngineApiService } from 'src/engine-api.service';
import {
  GetPreviousRowStatesQuery,
  GetPreviousRowStatesQueryReturnType,
} from 'src/features/row/queries/impl';
import { RowApiService } from 'src/features/row/row-api.service';
import { PluginService } from 'src/features/plugin/plugin.service';

type Scenario = {
  branchId: string;
  projectId: string;
  tableId: string;
  tableIds: string[];
  tableVersionIds: string[];
  rowVersionIds: string[];
  revisionIds: string[];
  tableCreatedId: string;
  rowCreatedId: string;
};

describe('GetPreviousRowStatesQuery', () => {
  it('returns an empty connection when the selected state is its creation', async () => {
    const scenario = await createScenario([{ rowId: 'row', value: 'A' }]);

    const result = await execute({
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

  it('returns the previous first-effective persisted state with context', async () => {
    const scenario = await createScenario([
      { rowId: 'row', value: 'A' },
      { rowId: 'row', value: 'B' },
    ]);

    const result = await execute({
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
    const scenario = await createScenario([
      { rowId: 'row', value: 'A' },
      { rowId: 'row', value: 'B' },
      { rowId: 'row', value: 'B' },
    ]);

    const result = await executeSelected(scenario, 'row');

    expect(projectStates(result)).toEqual([
      { value: 'A', rowId: 'row', revisionIndex: 0, introducedBy: ['created'] },
    ]);
  });

  it('keeps the pre-rename state after A to B to rename C', async () => {
    const scenario = await createScenario([
      { rowId: 'row', value: 'A' },
      { rowId: 'row', value: 'B' },
      { rowId: 'row-c', value: 'B' },
    ]);

    const result = await executeSelected(scenario, 'row-c');

    expect(projectStates(result)).toEqual([
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
    const scenario = await createScenario([
      { rowId: 'row', value: 'A' },
      { rowId: 'row-b', value: 'B' },
      { rowId: 'row-b', value: 'C' },
    ]);

    const result = await executeSelected(scenario, 'row-b');

    expect(projectStates(result)).toEqual([
      {
        value: 'B',
        rowId: 'row-b',
        revisionIndex: 1,
        introducedBy: ['renamed', 'modified'],
      },
      { value: 'A', rowId: 'row', revisionIndex: 0, introducedBy: ['created'] },
    ]);
  });

  it('keeps non-adjacent A to B to A reversion events', async () => {
    const scenario = await createScenario([
      { rowId: 'row', value: 'A' },
      { rowId: 'row', value: 'B' },
      { rowId: 'row', value: 'A' },
    ]);

    const result = await executeSelected(scenario, 'row');

    expect(projectStates(result)).toEqual([
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
    const scenario = await createScenario([
      { rowId: 'row', value: 'A', tableId: 'old-table' },
      { rowId: 'row', value: 'A', tableId: 'renamed-table' },
    ]);

    const result = await executeSelected(scenario, 'row');

    expect(result?.edges).toEqual([]);
    expect(result?.totalCount).toBe(0);
  });

  it('does not emit state for excluded persisted metadata changes', async () => {
    const scenario = await createScenario([
      { rowId: 'row', value: 'A' },
      { rowId: 'row', value: 'A' },
    ]);
    await kit.prismaService.row.update({
      where: { versionId: scenario.rowVersionIds[1] as string },
      data: {
        meta: { changed: true },
        schemaHash: 'different-schema',
        publishedAt: new Date('2026-08-14T00:00:00.000Z'),
        readonly: true,
      },
    });

    const result = await executeSelected(scenario, 'row');

    expect(result?.edges).toEqual([]);
    expect(result?.totalCount).toBe(0);
  });

  it('does not let unrelated Table copy-on-write create a row event', async () => {
    const scenario = await createScenario([
      { rowId: 'row', value: 'A' },
      { rowId: 'row', value: 'A' },
    ]);
    const unrelatedCreatedId = nanoid();
    for (const [index, revisionId] of scenario.revisionIds.entries()) {
      await kit.prismaService.table.create({
        data: {
          id: `unrelated-${index}`,
          createdId: unrelatedCreatedId,
          versionId: nanoid(),
          revisions: { connect: { id: revisionId } },
        },
      });
    }

    const result = await executeSelected(scenario, 'row');

    expect(result?.edges).toEqual([]);
    expect(result?.totalCount).toBe(0);
  });

  it('isolates reuse of a row id with a new stable createdId', async () => {
    const scenario = await createScenario([
      { rowId: 'row', value: 'OLD' },
      { rowId: 'row', value: 'NEW', newRowIdentity: true },
    ]);

    const result = await executeSelected(scenario, 'row');

    expect(result?.edges).toEqual([]);
    expect(result?.totalCount).toBe(0);
  });

  it('concatenates keyset pages with an exact stable totalCount', async () => {
    const scenario = await createScenario(
      ['A', 'B', 'C', 'D', 'E'].map((value) => ({ rowId: 'row', value })),
    );

    const firstPage = await execute({
      revisionId: scenario.revisionIds.at(-1) as string,
      tableId: scenario.tableIds.at(-1) as string,
      rowId: 'row',
      first: 2,
    });
    const secondPage = await execute({
      revisionId: scenario.revisionIds.at(-1) as string,
      tableId: scenario.tableIds.at(-1) as string,
      rowId: 'row',
      first: 2,
      after: firstPage?.pageInfo.endCursor,
    });

    expect(firstPage?.totalCount).toBe(4);
    expect(secondPage?.totalCount).toBe(4);
    expect(firstPage?.pageInfo.hasNextPage).toBe(true);
    expect(firstPage?.pageInfo.hasPreviousPage).toBe(false);
    expect(secondPage?.pageInfo.hasNextPage).toBe(false);
    expect(secondPage?.pageInfo.hasPreviousPage).toBe(true);
    expect(
      [...(firstPage?.edges ?? []), ...(secondPage?.edges ?? [])].map(
        ({ node }) => (node.row.data as { value: string }).value,
      ),
    ).toEqual(['D', 'C', 'B', 'A']);
  });

  it('rejects malformed, scope-mismatched, and non-event cursors', async () => {
    const firstScenario = await createScenario([
      { rowId: 'row', value: 'A' },
      { rowId: 'row', value: 'B' },
      { rowId: 'row', value: 'C' },
    ]);
    const firstPage = await execute({
      revisionId: firstScenario.revisionIds.at(-1) as string,
      tableId: firstScenario.tableIds.at(-1) as string,
      rowId: 'row',
      first: 1,
    });
    const cursor = firstPage?.pageInfo.endCursor as string;

    await expect(
      execute({
        revisionId: firstScenario.revisionIds.at(-1) as string,
        tableId: firstScenario.tableIds.at(-1) as string,
        rowId: 'row',
        first: 1,
        after: 'not-a-json-cursor',
      }),
    ).rejects.toThrow(BadRequestException);

    const secondScenario = await createScenario([
      { rowId: 'row', value: 'A' },
      { rowId: 'row', value: 'B' },
    ]);
    await expect(
      execute({
        revisionId: secondScenario.revisionIds.at(-1) as string,
        tableId: secondScenario.tableIds.at(-1) as string,
        rowId: 'row',
        first: 1,
        after: cursor,
      }),
    ).rejects.toThrow(BadRequestException);

    const nonEventPayload = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    nonEventPayload.eventRevisionId = firstScenario.revisionIds.at(
      -1,
    ) as string;
    await expect(
      execute({
        revisionId: firstScenario.revisionIds.at(-1) as string,
        tableId: firstScenario.tableIds.at(-1) as string,
        rowId: 'row',
        first: 1,
        after: Buffer.from(JSON.stringify(nonEventPayload)).toString(
          'base64url',
        ),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an explicitly supplied empty cursor', async () => {
    const scenario = await createScenario([
      { rowId: 'row', value: 'A' },
      { rowId: 'row', value: 'B' },
    ]);

    await expect(
      execute({
        revisionId: scenario.revisionIds.at(-1) as string,
        tableId: scenario.tableIds.at(-1) as string,
        rowId: 'row',
        first: 1,
        after: '',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a different-tip cursor before an unresolved selector', async () => {
    const scenario = await createScenario([
      { rowId: 'row', value: 'A' },
      { rowId: 'row', value: 'B' },
      { rowId: 'row', value: 'C' },
    ]);
    const firstPage = await execute({
      revisionId: scenario.revisionIds.at(-1) as string,
      tableId: scenario.tableIds.at(-1) as string,
      rowId: 'row',
      first: 1,
    });

    await expect(
      execute({
        revisionId: nanoid(),
        tableId: scenario.tableIds.at(-1) as string,
        rowId: 'row',
        first: 1,
        after: firstPage?.pageInfo.endCursor as string,
      }),
    ).rejects.toThrow('Previous row states cursor');
  });

  it('rejects a cursor after its selected Row snapshot is invalidated', async () => {
    const scenario = await createScenario([
      { rowId: 'row', value: 'A' },
      { rowId: 'row', value: 'B' },
      { rowId: 'row', value: 'C' },
    ]);
    const firstPage = await execute({
      revisionId: scenario.revisionIds.at(-1) as string,
      tableId: scenario.tableIds.at(-1) as string,
      rowId: 'row',
      first: 1,
    });
    await kit.prismaService.row.update({
      where: { versionId: scenario.rowVersionIds.at(-1) as string },
      data: { id: 'renamed-after-cursor' },
    });

    await expect(
      execute({
        revisionId: scenario.revisionIds.at(-1) as string,
        tableId: scenario.tableIds.at(-1) as string,
        rowId: 'row',
        first: 1,
        after: firstPage?.pageInfo.endCursor as string,
      }),
    ).rejects.toThrow('Previous row states cursor');
  });

  it.each([0, 101, 1.5])('rejects invalid first=%s', async (first) => {
    const scenario = await createScenario([{ rowId: 'row', value: 'A' }]);

    await expect(
      execute({
        revisionId: scenario.revisionIds[0] as string,
        tableId: scenario.tableIds[0] as string,
        rowId: 'row',
        first,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('is exposed through the public row API', async () => {
    const scenario = await createScenario([
      { rowId: 'row', value: 'A' },
      { rowId: 'row', value: 'B' },
    ]);
    const rowApi = kit.module.get(RowApiService);

    const result = await rowApi.getPreviousRowStates({
      revisionId: scenario.revisionIds.at(-1) as string,
      tableId: scenario.tableIds.at(-1) as string,
      rowId: 'row',
      first: 10,
    });

    expect(result?.totalCount).toBe(1);
  });

  it('delegates through the flat EngineApi facade', async () => {
    const scenario = await createScenario([
      { rowId: 'row', value: 'A' },
      { rowId: 'row', value: 'B' },
    ]);
    const data = {
      revisionId: scenario.revisionIds.at(-1) as string,
      tableId: scenario.tableIds.at(-1) as string,
      rowId: 'row',
      first: 10,
    };
    const rowApi = kit.module.get(RowApiService);
    const delegate = jest.spyOn(rowApi, 'getPreviousRowStates');
    const engineApi = Object.create(
      EngineApiService.prototype,
    ) as EngineApiService;
    Object.assign(engineApi as unknown as { rowApi: RowApiService }, {
      rowApi,
    });

    const result = await engineApi.getPreviousRowStates(data);

    expect(delegate).toHaveBeenCalledWith(data);
    expect(result?.totalCount).toBe(1);
    delegate.mockRestore();
  });

  it('follows parent ancestry across a branch without sibling or future leakage', async () => {
    const projectId = nanoid();
    const mainBranchId = await createBranch(projectId, true);
    const forkBranchId = await createBranch(projectId);
    const tableId = nanoid();
    const tableCreatedId = nanoid();
    const rowCreatedId = nanoid();

    const root = await addState({
      branchId: mainBranchId,
      tableId,
      tableCreatedId,
      rowCreatedId,
      rowId: 'row',
      value: 'A',
      isStart: true,
    });
    const parent = await addState({
      branchId: mainBranchId,
      parentId: root.revisionId,
      tableId,
      tableCreatedId,
      rowCreatedId,
      rowId: 'row',
      value: 'B',
    });
    await addState({
      branchId: mainBranchId,
      parentId: parent.revisionId,
      tableId,
      tableCreatedId,
      rowCreatedId,
      rowId: 'row',
      value: 'SIBLING',
    });
    const selected = await addState({
      branchId: forkBranchId,
      parentId: parent.revisionId,
      tableId,
      tableCreatedId,
      rowCreatedId,
      rowId: 'row',
      value: 'C',
    });

    const beforeFuture = await execute({
      revisionId: selected.revisionId,
      tableId,
      rowId: 'row',
      first: 10,
    });
    await addState({
      branchId: forkBranchId,
      parentId: selected.revisionId,
      tableId,
      tableCreatedId,
      rowCreatedId,
      rowId: 'row',
      value: 'FUTURE',
    });
    const afterFuture = await execute({
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

  it('returns null when the exact revision/table/row selector is unresolved', async () => {
    const scenario = await createScenario([{ rowId: 'row', value: 'A' }]);

    await expect(
      execute({
        revisionId: nanoid(),
        tableId: scenario.tableIds[0] as string,
        rowId: 'row',
        first: 10,
      }),
    ).resolves.toBeNull();
    await expect(
      execute({
        revisionId: scenario.revisionIds[0] as string,
        tableId: scenario.tableIds[0] as string,
        rowId: 'missing-row',
        first: 10,
      }),
    ).resolves.toBeNull();
  });

  it('rejects a Draft selected revision', async () => {
    const scenario = await createScenario([{ rowId: 'row', value: 'A' }]);
    await kit.prismaService.revision.update({
      where: { id: scenario.revisionIds[0] as string },
      data: { isDraft: true },
    });

    await expect(executeSelected(scenario, 'row')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a Draft revision inside committed ancestry', async () => {
    const scenario = await createScenario([
      { rowId: 'row', value: 'A' },
      { rowId: 'row', value: 'B' },
      { rowId: 'row', value: 'C' },
    ]);
    await kit.prismaService.revision.update({
      where: { id: scenario.revisionIds[1] as string },
      data: { isDraft: true },
    });

    await expect(executeSelected(scenario, 'row')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a broken non-start ancestry gap', async () => {
    const scenario = await createScenario([{ rowId: 'row', value: 'A' }]);
    await kit.prismaService.revision.update({
      where: { id: scenario.revisionIds[0] as string },
      data: { isStart: false },
    });

    await expect(executeSelected(scenario, 'row')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('accepts a valid root start when Branch.isRoot is false', async () => {
    const scenario = await createScenario([
      { rowId: 'row', value: 'A' },
      { rowId: 'row', value: 'B' },
    ]);
    await kit.prismaService.branch.update({
      where: { id: scenario.branchId },
      data: { isRoot: false },
    });

    const result = await executeSelected(scenario, 'row');

    expect(projectStates(result)).toEqual([
      { value: 'A', rowId: 'row', revisionIndex: 0, introducedBy: ['created'] },
    ]);
  });

  it('rejects a non-root fork start whose parent link is missing', async () => {
    const projectId = nanoid();
    const rootBranchId = await createBranch(projectId, true);
    const forkBranchId = await createBranch(projectId);
    const tableId = nanoid();
    const tableCreatedId = nanoid();
    const rowCreatedId = nanoid();
    const root = await addState({
      branchId: rootBranchId,
      tableId,
      tableCreatedId,
      rowCreatedId,
      rowId: 'row',
      value: 'A',
      isStart: true,
    });
    const forkStart = await addState({
      branchId: forkBranchId,
      parentId: root.revisionId,
      tableId,
      tableCreatedId,
      rowCreatedId,
      rowId: 'row',
      value: 'B',
      isStart: true,
    });
    const selected = await addState({
      branchId: forkBranchId,
      parentId: forkStart.revisionId,
      tableId,
      tableCreatedId,
      rowCreatedId,
      rowId: 'row',
      value: 'C',
    });
    await kit.prismaService.revision.update({
      where: { id: forkStart.revisionId },
      data: { parentId: null },
    });

    await expect(
      execute({
        revisionId: selected.revisionId,
        tableId,
        rowId: 'row',
        first: 10,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a cycle in the selected parent ancestry', async () => {
    const scenario = await createScenario([
      { rowId: 'row', value: 'A' },
      { rowId: 'row', value: 'B' },
    ]);
    await kit.prismaService.revision.update({
      where: { id: scenario.revisionIds[0] as string },
      data: { parentId: scenario.revisionIds[1] },
    });

    await expect(executeSelected(scenario, 'row')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects ancestry crossing a Project boundary', async () => {
    const ancestorBranchId = await createBranch(nanoid());
    const selectedBranchId = await createBranch(nanoid());
    const tableId = nanoid();
    const tableCreatedId = nanoid();
    const rowCreatedId = nanoid();
    const root = await addState({
      branchId: ancestorBranchId,
      tableId,
      tableCreatedId,
      rowCreatedId,
      rowId: 'row',
      value: 'A',
      isStart: true,
    });
    const selected = await addState({
      branchId: selectedBranchId,
      parentId: root.revisionId,
      tableId,
      tableCreatedId,
      rowCreatedId,
      rowId: 'row',
      value: 'B',
    });

    await expect(
      execute({
        revisionId: selected.revisionId,
        tableId,
        rowId: 'row',
        first: 10,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects duplicate logical Table and Row states', async () => {
    const duplicateTableScenario = await createScenario([
      { rowId: 'row', value: 'A' },
      { rowId: 'row', value: 'B' },
    ]);
    await kit.prismaService.table.create({
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
      executeSelected(duplicateTableScenario, 'row'),
    ).rejects.toThrow(BadRequestException);

    const duplicateRowScenario = await createScenario([
      { rowId: 'row', value: 'A' },
      { rowId: 'row', value: 'B' },
    ]);
    await kit.prismaService.row.create({
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
    await expect(executeSelected(duplicateRowScenario, 'row')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects disappearance and older reappearance of one stable Row identity', async () => {
    const projectId = nanoid();
    const branchId = await createBranch(projectId);
    const tableId = nanoid();
    const tableCreatedId = nanoid();
    const rowCreatedId = nanoid();
    const root = await addState({
      branchId,
      tableId,
      tableCreatedId,
      rowCreatedId,
      rowId: 'row',
      value: 'A',
      isStart: true,
    });
    const absent = await addTableOnlyState({
      branchId,
      parentId: root.revisionId,
      tableId,
      tableCreatedId,
    });
    const selected = await addState({
      branchId,
      parentId: absent.revisionId,
      tableId,
      tableCreatedId,
      rowCreatedId,
      rowId: 'row',
      value: 'B',
    });

    await expect(
      execute({
        revisionId: selected.revisionId,
        tableId,
        rowId: 'row',
        first: 10,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('hydrates valid persisted empty hash fields without plugin computation', async () => {
    const scenario = await createScenario([
      { rowId: 'row', value: 'A' },
      { rowId: 'row', value: 'B' },
    ]);
    await kit.prismaService.row.update({
      where: { versionId: scenario.rowVersionIds[0] as string },
      data: { hash: '', schemaHash: '' },
    });

    const plugin = kit.module.get(PluginService);
    const computeRows = jest.spyOn(plugin, 'computeRows');

    const result = await executeSelected(scenario, 'row');

    expect(result?.edges[0]?.node.row).toMatchObject({
      hash: '',
      schemaHash: '',
      data: { value: 'A' },
    });
    expect(computeRows).not.toHaveBeenCalled();
    computeRows.mockRestore();
  });

  async function execute(
    data: ConstructorParameters<typeof GetPreviousRowStatesQuery>[0],
  ): Promise<GetPreviousRowStatesQueryReturnType> {
    return queryBus.execute(new GetPreviousRowStatesQuery(data));
  }

  function executeSelected(scenario: Scenario, rowId: string) {
    return execute({
      revisionId: scenario.revisionIds.at(-1) as string,
      tableId: scenario.tableIds.at(-1) as string,
      rowId,
      first: 10,
    });
  }

  function projectStates(result: GetPreviousRowStatesQueryReturnType) {
    return result?.edges.map(({ node }) => ({
      value: (node.row.data as { value: string }).value,
      rowId: node.row.id,
      revisionIndex: currentScenarioRevisionIds.indexOf(node.revision.id),
      introducedBy: node.introducedBy,
    }));
  }

  async function createScenario(
    states: ReadonlyArray<{
      rowId: string;
      value: string;
      tableId?: string;
      newRowIdentity?: boolean;
    }>,
  ): Promise<Scenario> {
    const branchId = nanoid();
    const projectId = nanoid();
    const tableId = nanoid();
    const tableCreatedId = nanoid();
    let rowCreatedId = nanoid();
    const revisionIds: string[] = [];
    const tableIds: string[] = [];
    const tableVersionIds: string[] = [];
    const rowVersionIds: string[] = [];

    await kit.prismaService.branch.create({
      data: { id: branchId, name: nanoid(), projectId, isRoot: true },
    });

    for (const [index, state] of states.entries()) {
      const revisionId = nanoid();
      const tableVersionId = nanoid();
      const stateTableId = state.tableId ?? tableId;
      if (state.newRowIdentity) {
        rowCreatedId = nanoid();
      }
      revisionIds.push(revisionId);
      tableIds.push(stateTableId);
      tableVersionIds.push(tableVersionId);

      await kit.prismaService.revision.create({
        data: {
          id: revisionId,
          branchId,
          isStart: index === 0,
          parentId: revisionIds[index - 1],
        },
      });
      await kit.prismaService.table.create({
        data: {
          id: stateTableId,
          createdId: tableCreatedId,
          versionId: tableVersionId,
          revisions: { connect: { id: revisionId } },
        },
      });
      const row = await kit.prismaService.row.create({
        data: {
          id: state.rowId,
          createdId: rowCreatedId,
          versionId: nanoid(),
          data: { value: state.value },
          hash: state.value,
          schemaHash: 'test-schema',
          tables: { connect: { versionId: tableVersionId } },
        },
      });
      rowVersionIds.push(row.versionId);
    }

    currentScenarioRevisionIds = revisionIds;
    return {
      branchId,
      projectId,
      tableId,
      tableIds,
      tableVersionIds,
      rowVersionIds,
      revisionIds,
      tableCreatedId,
      rowCreatedId,
    };
  }

  async function createBranch(
    projectId: string,
    isRoot = false,
  ): Promise<string> {
    const branch = await kit.prismaService.branch.create({
      data: { id: nanoid(), name: nanoid(), projectId, isRoot },
    });
    return branch.id;
  }

  async function addState({
    branchId,
    parentId,
    tableId,
    tableCreatedId,
    rowCreatedId,
    rowId,
    value,
    isStart = false,
  }: {
    branchId: string;
    parentId?: string;
    tableId: string;
    tableCreatedId: string;
    rowCreatedId: string;
    rowId: string;
    value: string;
    isStart?: boolean;
  }) {
    const revisionId = nanoid();
    const tableVersionId = nanoid();
    await kit.prismaService.revision.create({
      data: { id: revisionId, branchId, parentId, isStart },
    });
    await kit.prismaService.table.create({
      data: {
        id: tableId,
        createdId: tableCreatedId,
        versionId: tableVersionId,
        revisions: { connect: { id: revisionId } },
      },
    });
    await kit.prismaService.row.create({
      data: {
        id: rowId,
        createdId: rowCreatedId,
        versionId: nanoid(),
        data: { value },
        hash: value,
        schemaHash: 'test-schema',
        tables: { connect: { versionId: tableVersionId } },
      },
    });
    return { revisionId, tableVersionId };
  }

  async function addTableOnlyState({
    branchId,
    parentId,
    tableId,
    tableCreatedId,
  }: {
    branchId: string;
    parentId: string;
    tableId: string;
    tableCreatedId: string;
  }) {
    const revisionId = nanoid();
    await kit.prismaService.revision.create({
      data: { id: revisionId, branchId, parentId },
    });
    await kit.prismaService.table.create({
      data: {
        id: tableId,
        createdId: tableCreatedId,
        versionId: nanoid(),
        revisions: { connect: { id: revisionId } },
      },
    });
    return { revisionId };
  }

  let kit: QueryTestKit;
  let queryBus: QueryBus;
  let currentScenarioRevisionIds: string[] = [];

  beforeAll(async () => {
    kit = await createQueryTestKit();
    queryBus = kit.queryBus;
  });

  afterAll(async () => {
    await kit.close();
  });
});
