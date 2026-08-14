import type { TestingModule } from '@nestjs/testing';
import { nanoid } from 'nanoid';
import {
  createQueryTestKit,
  type QueryTestKit,
} from 'src/__tests__/kit/create-query-test-kit';
import type { PrismaService } from 'src/infrastructure/database/prisma.service';
import type {
  GetPreviousRowStatesQueryData,
  GetPreviousRowStatesQueryReturnType,
} from 'src/features/row/queries/impl';
import { PreviousRowStatesService } from 'src/features/row/services/previous-row-states.service';

const DEFAULT_PAGE_SIZE = 10;

export type PreviousRowStatesScenarioState = {
  readonly rowId: string;
  readonly value: string;
  readonly tableId?: string;
  readonly newRowIdentity?: boolean;
};

export type PreviousRowStatesScenario = {
  readonly branchId: string;
  readonly projectId: string;
  readonly tableId: string;
  readonly tableIds: readonly string[];
  readonly tableVersionIds: readonly string[];
  readonly rowVersionIds: readonly string[];
  readonly revisionIds: readonly string[];
  readonly tableCreatedId: string;
  readonly rowCreatedId: string;
};

export type PersistedRowState = {
  readonly revisionId: string;
  readonly tableVersionId: string;
};

export class PreviousRowStatesFixture {
  private constructor(private readonly kit: QueryTestKit) {}

  static async create(): Promise<PreviousRowStatesFixture> {
    return new PreviousRowStatesFixture(await createQueryTestKit());
  }

  get module(): TestingModule {
    return this.kit.module;
  }

  get prisma(): PrismaService {
    return this.kit.prismaService;
  }

  get service(): PreviousRowStatesService {
    return this.module.get(PreviousRowStatesService);
  }

  async close(): Promise<void> {
    await this.kit.close();
  }

  execute(
    data: GetPreviousRowStatesQueryData,
  ): Promise<GetPreviousRowStatesQueryReturnType> {
    return this.service.get(data);
  }

  executeSelected({
    scenario,
    rowId,
    first = DEFAULT_PAGE_SIZE,
  }: {
    scenario: PreviousRowStatesScenario;
    rowId: string;
    first?: number;
  }): Promise<GetPreviousRowStatesQueryReturnType> {
    return this.execute({
      revisionId: scenario.revisionIds.at(-1) as string,
      tableId: scenario.tableIds.at(-1) as string,
      rowId,
      first,
    });
  }

  projectStates({
    result,
    scenario,
  }: {
    result: GetPreviousRowStatesQueryReturnType;
    scenario: PreviousRowStatesScenario;
  }) {
    return result?.edges.map(({ node }) => ({
      value: (node.row.data as { value: string }).value,
      rowId: node.row.id,
      revisionIndex: scenario.revisionIds.indexOf(node.revision.id),
      introducedBy: node.introducedBy,
    }));
  }

  async createLinearScenario({
    states,
  }: {
    states: readonly PreviousRowStatesScenarioState[];
  }): Promise<PreviousRowStatesScenario> {
    const branchId = nanoid();
    const projectId = nanoid();
    const tableId = nanoid();
    const tableCreatedId = nanoid();
    let rowCreatedId = nanoid();
    const revisionIds: string[] = [];
    const tableIds: string[] = [];
    const tableVersionIds: string[] = [];
    const rowVersionIds: string[] = [];

    await this.prisma.branch.create({
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

      await this.prisma.revision.create({
        data: {
          id: revisionId,
          branchId,
          isStart: index === 0,
          parentId: revisionIds[index - 1],
        },
      });
      await this.prisma.table.create({
        data: {
          id: stateTableId,
          createdId: tableCreatedId,
          versionId: tableVersionId,
          revisions: { connect: { id: revisionId } },
        },
      });
      const row = await this.prisma.row.create({
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

  async createBranch({
    projectId,
    isRoot = false,
  }: {
    projectId: string;
    isRoot?: boolean;
  }): Promise<string> {
    const branch = await this.prisma.branch.create({
      data: { id: nanoid(), name: nanoid(), projectId, isRoot },
    });
    return branch.id;
  }

  async addState({
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
  }): Promise<PersistedRowState> {
    const revisionId = nanoid();
    const tableVersionId = nanoid();
    await this.prisma.revision.create({
      data: { id: revisionId, branchId, parentId, isStart },
    });
    await this.prisma.table.create({
      data: {
        id: tableId,
        createdId: tableCreatedId,
        versionId: tableVersionId,
        revisions: { connect: { id: revisionId } },
      },
    });
    await this.prisma.row.create({
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

  async addTableOnlyState({
    branchId,
    parentId,
    tableId,
    tableCreatedId,
    isStart = false,
  }: {
    branchId: string;
    parentId?: string;
    tableId: string;
    tableCreatedId: string;
    isStart?: boolean;
  }): Promise<{ readonly revisionId: string }> {
    const revisionId = nanoid();
    await this.prisma.revision.create({
      data: { id: revisionId, branchId, parentId, isStart },
    });
    await this.prisma.table.create({
      data: {
        id: tableId,
        createdId: tableCreatedId,
        versionId: nanoid(),
        revisions: { connect: { id: revisionId } },
      },
    });
    return { revisionId };
  }
}
