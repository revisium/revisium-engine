import { BadRequestException, Injectable } from '@nestjs/common';
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
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import type { RowWhereInput } from 'src/engine-prisma-types';
import type { WhereConditionsTyped } from '@revisium/prisma-pg-json';
import { COW_ROW_FIELDS } from 'src/features/versioning-engine/utils/cow-get-rows-sql';

@Injectable()
export class CowVersioningEngineService implements VersioningEngine {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionService: TransactionPrismaService,
    private readonly shareQueries: ShareTransactionalQueries,
    private readonly pluginService: PluginService,
    private readonly systemColumnMappingService: SystemColumnMappingService,
    private readonly currentVersioningEngine: CurrentVersioningEngineService,
    private readonly cowStateService: CowVersioningStateService,
  ) {}

  async getRows(data: GetRowsQueryData): Promise<GetRowsQueryReturnType> {
    const mappedData = await this.mapFieldsToSystemColumns(data);
    const whereConditions = this.validateWhereConditions(mappedData.where);
    const orderBy = this.validateOrderByConditions(mappedData.orderBy);
    const tableStateId = await this.cowStateService.resolveTableStateId(
      data.revisionId,
      data.tableId,
    );

    return getCowKeysetPagination({
      pageData: data,
      tableStateId,
      whereConditions,
      orderBy,
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

  private validateWhereConditions(
    where: RowWhereInput | undefined,
  ): WhereConditionsTyped<typeof COW_ROW_FIELDS> | undefined {
    if (!where) {
      return undefined;
    }

    this.assertSupportedWhereKeys(where);

    return where as WhereConditionsTyped<typeof COW_ROW_FIELDS>;
  }

  private assertSupportedWhereKeys(where: RowWhereInput): void {
    for (const [key, value] of Object.entries(where)) {
      if (value == null) {
        continue;
      }

      if (this.isLogicalArrayKey(key)) {
        this.assertSupportedWhereClauses(value as RowWhereInput[]);
        continue;
      }

      if (key === 'NOT') {
        this.assertSupportedNotClause(value);
        continue;
      }

      if (!(key in COW_ROW_FIELDS)) {
        throw new BadRequestException(
          `Filtering by field "${key}" is not supported by the COW engine`,
        );
      }
    }
  }

  private isLogicalArrayKey(key: string): key is 'AND' | 'OR' {
    return key === 'AND' || key === 'OR';
  }

  private assertSupportedWhereClauses(clauses: RowWhereInput[]): void {
    for (const clause of clauses) {
      this.assertSupportedWhereKeys(clause);
    }
  }

  private assertSupportedNotClause(value: unknown): void {
    if (Array.isArray(value)) {
      this.assertSupportedWhereClauses(value as RowWhereInput[]);
      return;
    }

    this.assertSupportedWhereKeys(value as RowWhereInput);
  }

  private validateOrderByConditions(
    orderBy: GetRowsQueryData['orderBy'],
  ): GetRowsQueryData['orderBy'] {
    if (!orderBy) {
      return undefined;
    }

    for (const condition of orderBy) {
      for (const key of Object.keys(condition)) {
        if (!(key in COW_ROW_FIELDS)) {
          throw new BadRequestException(
            `Ordering by field "${key}" is not supported by the COW engine`,
          );
        }
      }
    }

    return orderBy;
  }

  private findBranchInProjectOrThrow(projectId: string, branchName: string) {
    return this.transactionService.runSerializable(() =>
      this.shareQueries.findBranchInProjectOrThrow(projectId, branchName),
    );
  }
}
