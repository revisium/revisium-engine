import { Injectable } from '@nestjs/common';
import type { ApiCreateBranchByRevisionIdCommandData } from 'src/features/branch/commands/impl/api-create-branch-by-revision-id.command';
import type {
  ApiRevertChangesCommandData,
  ApiRevertChangesCommandReturnType,
} from 'src/features/draft/commands/impl/api-revert-changes.command';
import type {
  ApiCreateRevisionCommandData,
  ApiCreateRevisionCommandReturnType,
} from 'src/features/draft/commands/impl/api-create-revision.command';
import type {
  GetRowsQueryData,
  GetRowsQueryReturnType,
} from 'src/features/row/queries/impl/get-rows.query';
import { PluginService } from 'src/features/plugin/plugin.service';
import { ShareTransactionalQueries } from 'src/features/share/share.transactional.queries';
import { SystemColumnMappingService } from 'src/features/row/services/system-column-mapping.service';
import { getCowKeysetPagination } from 'src/features/versioning-engine/utils/cow-get-keyset-pagination';
import { CurrentVersioningEngineService } from 'src/features/versioning-engine/services/current-versioning-engine.service';
import { CowVersioningStateService } from 'src/features/versioning-engine/services/cow-versioning-state.service';
import { VersioningEngine } from 'src/features/versioning-engine/versioning-engine.interface';
import { PrismaService } from 'src/infrastructure/database/prisma.service';

@Injectable()
export class CowVersioningEngineService implements VersioningEngine {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shareQueries: ShareTransactionalQueries,
    private readonly pluginService: PluginService,
    private readonly systemColumnMappingService: SystemColumnMappingService,
    private readonly currentVersioningEngine: CurrentVersioningEngineService,
    private readonly cowStateService: CowVersioningStateService,
  ) {}

  async getRows(data: GetRowsQueryData): Promise<GetRowsQueryReturnType> {
    const tableStateId = await this.cowStateService.resolveTableStateId(
      data.revisionId,
      data.tableId,
    );
    const mappedData = await this.mapFieldsToSystemColumns(data);

    return getCowKeysetPagination({
      pageData: data,
      tableStateId,
      whereConditions: mappedData.where as never,
      orderBy: mappedData.orderBy,
      queryRaw: (sql) => this.prisma.$queryRaw(sql),
      transformRows: async (rows) => {
        const { formulaErrors } = await this.pluginService.computeRows({
          revisionId: data.revisionId,
          tableId: data.tableId,
          rows,
        });

        return rows.map((row) => ({
          ...row,
          context: {
            revisionId: data.revisionId,
            tableId: data.tableId,
          },
          formulaErrors: formulaErrors?.get(row.id),
        }));
      },
    });
  }

  async createRevision(
    data: ApiCreateRevisionCommandData,
  ): Promise<ApiCreateRevisionCommandReturnType> {
    const branch = await this.findBranchInProjectOrThrow(
      data.projectId,
      data.branchName,
    );

    const result = await this.currentVersioningEngine.createRevision(data);

    await this.cowStateService.snapshotCommittedRevisionFromCurrent(
      result.previousDraftRevisionId,
    );
    await this.cowStateService.syncDraftStateFromCurrent(branch.id);

    return result;
  }

  async revertChanges(
    data: ApiRevertChangesCommandData,
  ): Promise<ApiRevertChangesCommandReturnType> {
    const branch = await this.findBranchInProjectOrThrow(
      data.projectId,
      data.branchName,
    );

    const result = await this.currentVersioningEngine.revertChanges(data);
    await this.cowStateService.syncDraftStateFromCurrent(branch.id);

    return result;
  }

  async createBranch(
    data: ApiCreateBranchByRevisionIdCommandData,
  ): Promise<{ id: string }> {
    await this.cowStateService.ensureRevisionSnapshot(data.revisionId);

    const result = await this.currentVersioningEngine.createBranch(data);
    const headRevision = await this.prisma.revision.findFirstOrThrow({
      where: { branchId: result.id, isHead: true },
      select: { id: true },
    });

    await this.cowStateService.seedBranchFromRevision(
      data.revisionId,
      result.id,
      headRevision.id,
    );

    return result;
  }

  private async mapFieldsToSystemColumns(
    data: GetRowsQueryData,
  ): Promise<GetRowsQueryData> {
    const { schema } = await this.shareQueries.getTableSchema(
      data.revisionId,
      data.tableId,
    );

    return {
      ...data,
      where: this.systemColumnMappingService.mapWhereConditions(
        data.where,
        schema,
      ),
      orderBy: this.systemColumnMappingService.mapOrderByConditions(
        data.orderBy,
        schema,
      ),
    };
  }

  private findBranchInProjectOrThrow(projectId: string, branchName: string) {
    return this.prisma.branch.findFirstOrThrow({
      where: {
        projectId,
        name: { equals: branchName, mode: 'insensitive' },
      },
      select: { id: true },
    });
  }
}
