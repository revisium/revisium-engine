import { BadRequestException, Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { BranchApiService } from 'src/features/branch/branch-api.service';
import {
  DraftRevisionGetOrCreateDraftRowCommand,
  DraftRevisionGetOrCreateDraftRowCommandData,
  DraftRevisionGetOrCreateDraftRowCommandReturnType,
  DraftRevisionGetOrCreateDraftTableCommand,
  DraftRevisionGetOrCreateDraftTableCommandData,
  DraftRevisionGetOrCreateDraftTableCommandReturnType,
  DraftRevisionRecomputeHasChangesCommand,
} from 'src/features/draft-revision/commands/impl';
import { RevisionsApiService } from 'src/features/revision/revisions-api.service';
import { DiffService } from 'src/features/share/diff.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

const RECORD_NOT_FOUND = 'P2025';

@Injectable()
export class DraftRevisionInternalService {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly transactionService: TransactionPrismaService,
    private readonly revisionsApiService: RevisionsApiService,
    private readonly branchApiService: BranchApiService,
    private readonly diffService: DiffService,
  ) {}

  private get transaction() {
    return this.transactionService.getTransaction();
  }

  public getOrCreateDraftTable(
    data: DraftRevisionGetOrCreateDraftTableCommandData,
  ): Promise<DraftRevisionGetOrCreateDraftTableCommandReturnType> {
    return this.commandBus.execute(
      new DraftRevisionGetOrCreateDraftTableCommand(data),
    );
  }

  public getOrCreateDraftRow(
    data: DraftRevisionGetOrCreateDraftRowCommandData,
  ): Promise<DraftRevisionGetOrCreateDraftRowCommandReturnType> {
    return this.commandBus.execute(
      new DraftRevisionGetOrCreateDraftRowCommand(data),
    );
  }

  public async markRevisionAsChanged(revisionId: string): Promise<void> {
    await this.transaction.revision.updateMany({
      where: { id: revisionId, hasChanges: false },
      data: { hasChanges: true },
    });
  }

  public async recomputeHasChanges(
    revisionId: string,
    tableId: string,
  ): Promise<void> {
    await this.commandBus.execute(
      new DraftRevisionRecomputeHasChangesCommand({ revisionId, tableId }),
    );
  }

  public async updateHasChanges(
    revisionId: string,
    parentRevisionId: string,
  ): Promise<void> {
    const hasChanges = await this.diffService.hasTableDiffs({
      fromRevisionId: parentRevisionId,
      toRevisionId: revisionId,
    });

    await this.transaction.revision.update({
      where: { id: revisionId },
      data: { hasChanges },
    });
  }

  public async findRevisionOrThrow(revisionId: string) {
    try {
      return await this.revisionsApiService.revision({ revisionId });
    } catch (error) {
      throw notFoundAsBadRequest(error, 'Revision not found');
    }
  }

  public async findHeadRevisionOrThrow(branchId: string) {
    try {
      return await this.branchApiService.getHeadRevision(branchId);
    } catch (error) {
      throw notFoundAsBadRequest(error, 'Head revision not found');
    }
  }

  public async findDraftRevisionOrThrow(branchId: string) {
    try {
      return await this.branchApiService.getDraftRevision(branchId);
    } catch (error) {
      throw notFoundAsBadRequest(error, 'Draft revision not found');
    }
  }

  public async getRevisionTableVersionIds(
    revisionId: string,
  ): Promise<{ versionId: string }[]> {
    return this.transaction.revision
      .findUniqueOrThrow({ where: { id: revisionId } })
      .tables({ select: { versionId: true } });
  }

  public async findParentRevisionIdOrThrow(
    revisionId: string,
  ): Promise<string> {
    const revision = await this.transaction.revision.findUniqueOrThrow({
      where: { id: revisionId },
      select: { parentId: true },
    });

    if (!revision.parentId) {
      throw new BadRequestException('Parent revision not found');
    }

    return revision.parentId;
  }

  public async ensureTableNotExists(
    revisionId: string,
    tableId: string,
  ): Promise<void> {
    const exists = await this.tableExistsInRevision(revisionId, tableId);
    if (exists) {
      throw new BadRequestException(
        'A table with this name already exists in the revision',
      );
    }
  }

  private async tableExistsInRevision(
    revisionId: string,
    tableId: string,
  ): Promise<boolean> {
    const table = await this.transaction.table.findFirst({
      where: {
        id: { equals: tableId, mode: 'insensitive' },
        revisions: {
          some: { id: revisionId },
        },
      },
      select: { versionId: true },
    });
    return table !== null;
  }
}

function notFoundAsBadRequest(error: unknown, message: string): unknown {
  if ((error as { code?: string } | undefined)?.code === RECORD_NOT_FOUND) {
    return new BadRequestException(message);
  }

  return error;
}
