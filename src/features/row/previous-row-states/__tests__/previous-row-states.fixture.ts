import type { TestingModule } from '@nestjs/testing';
import { nanoid } from 'nanoid';
import type { InputJsonValue } from 'src/engine-prisma-types';
import {
  createQueryTestKit,
  type QueryTestKit,
} from 'src/__tests__/kit/create-query-test-kit';
import type { PrismaService } from 'src/infrastructure/database/prisma.service';
import {
  GetPreviousRowStatesQuery,
  type GetPreviousRowStatesQueryData,
  type GetPreviousRowStatesQueryReturnType,
} from 'src/features/row/queries/impl';
import {
  PreviousRowStatesScenario as DeclarativePreviousRowStatesScenario,
  type PersistedPreviousRowStatesRevision,
  type PreviousRowStatesDefinition,
} from './previous-row-states.scenario';

/** Real-PostgreSQL fixture behind the declarative history scenario language. */
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

  async close(): Promise<void> {
    await this.kit.close();
  }

  execute(
    data: GetPreviousRowStatesQueryData,
  ): Promise<GetPreviousRowStatesQueryReturnType> {
    return this.kit.queryBus.execute(new GetPreviousRowStatesQuery(data));
  }

  async given(
    definition: PreviousRowStatesDefinition,
  ): Promise<DeclarativePreviousRowStatesScenario> {
    const branchDefinitions = definition.branches ?? { main: { root: true } };
    const projectIds = new Map<string, string>();
    const branches = new Map<string, string>();
    const tableCreatedIds = new Map<string, string>();
    const rowCreatedIds = new Map<string, string>();
    const revisions = new Map<string, PersistedPreviousRowStatesRevision>();
    const startedBranches = new Set<string>();

    for (const [alias, branchDefinition] of Object.entries(branchDefinitions)) {
      const branchId = nanoid();
      const projectId = this.identityId(
        projectIds,
        branchDefinition.project ?? 'project',
      );
      await this.prisma.branch.create({
        data: {
          id: branchId,
          name: alias,
          projectId,
          isRoot: branchDefinition.root ?? false,
        },
      });
      branches.set(alias, branchId);
    }

    let previousRevisionAlias: string | null = null;
    for (const revisionDefinition of definition.revisions) {
      const branchAlias = revisionDefinition.branch ?? 'main';
      const branchId = branches.get(branchAlias);
      if (!branchId) {
        throw new Error(`Unknown branch alias "${branchAlias}"`);
      }
      if (revisions.has(revisionDefinition.as)) {
        throw new Error(`Duplicate revision alias "${revisionDefinition.as}"`);
      }

      const parentAlias =
        revisionDefinition.parent === undefined
          ? previousRevisionAlias
          : revisionDefinition.parent;
      const parentId =
        parentAlias === null
          ? undefined
          : revisions.get(parentAlias)?.revisionId;
      if (parentAlias !== null && !parentId) {
        throw new Error(`Unknown parent revision alias "${parentAlias}"`);
      }

      const tableIdentity = revisionDefinition.table?.identity ?? 'table';
      const tableCreatedId = this.identityId(tableCreatedIds, tableIdentity);
      const tableId = revisionDefinition.table?.id ?? 'table';
      const revisionId = nanoid();
      const tableVersionId = nanoid();
      await this.prisma.revision.create({
        data: {
          id: revisionId,
          branchId,
          parentId,
          isStart:
            revisionDefinition.start ?? !startedBranches.has(branchAlias),
          isDraft: revisionDefinition.draft ?? false,
        },
      });
      startedBranches.add(branchAlias);
      await this.prisma.table.create({
        data: {
          id: tableId,
          createdId: tableCreatedId,
          versionId: tableVersionId,
          revisions: { connect: { id: revisionId } },
        },
      });

      let rowId: string | null = null;
      let rowCreatedId: string | null = null;
      let rowVersionId: string | null = null;
      if (revisionDefinition.row) {
        const rowIdentity = revisionDefinition.row.identity ?? 'record';
        rowId = revisionDefinition.row.id ?? 'row';
        rowCreatedId = this.identityId(rowCreatedIds, rowIdentity);
        rowVersionId = nanoid();
        await this.prisma.row.create({
          data: {
            id: rowId,
            createdId: rowCreatedId,
            versionId: rowVersionId,
            data: revisionDefinition.row.data as InputJsonValue,
            hash: JSON.stringify(revisionDefinition.row.data),
            schemaHash: 'test-schema',
            tables: { connect: { versionId: tableVersionId } },
          },
        });
      }

      revisions.set(revisionDefinition.as, {
        revisionId,
        branch: branchAlias,
        branchId,
        tableId,
        tableCreatedId,
        tableVersionId,
        rowId,
        rowCreatedId,
        rowVersionId,
      });
      previousRevisionAlias = revisionDefinition.as;
    }

    return new DeclarativePreviousRowStatesScenario(
      revisions,
      branches,
      (data) => this.execute(data),
    );
  }

  private identityId(identities: Map<string, string>, alias: string): string {
    const existing = identities.get(alias);
    if (existing) {
      return existing;
    }
    const createdId = nanoid();
    identities.set(alias, createdId);
    return createdId;
  }
}
