import { Injectable } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { CleanupFileBlobsByIdsCommand } from 'src/features/file-usage/commands/impl/cleanup-file-blobs-by-ids.command';
import {
  FileBlobCleanupService,
  OrphanBlobRow,
} from 'src/features/file-usage/services/file-blob-cleanup.service';
import { CleanupOrphanedFileBlobsResult } from 'src/features/file-usage/types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@Injectable()
@CommandHandler(CleanupFileBlobsByIdsCommand)
export class CleanupFileBlobsByIdsHandler implements ICommandHandler<
  CleanupFileBlobsByIdsCommand,
  CleanupOrphanedFileBlobsResult
> {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly transactionPrisma: TransactionPrismaService,
    private readonly cleanup: FileBlobCleanupService,
  ) {}

  async execute({
    data,
  }: CleanupFileBlobsByIdsCommand): Promise<CleanupOrphanedFileBlobsResult> {
    if (data.blobIds.length === 0) {
      return this.cleanup.emptyResult();
    }

    const orphans = await this.findOrphansByIds(data.projectId, data.blobIds);
    return this.cleanup.finalizeForSingleProject(data.projectId, orphans);
  }

  private async findOrphansByIds(
    projectId: string,
    blobIds: readonly string[],
  ): Promise<OrphanBlobRow[]> {
    return this.prisma.fileBlob.findMany({
      where: {
        id: { in: [...blobIds] },
        projectId,
        deletedAt: null,
        rows: { none: {} },
      },
      select: { id: true, projectId: true, hash: true, size: true },
    });
  }

  private get prisma() {
    return this.transactionPrisma.getTransactionUnsafe() ?? this.prismaService;
  }
}
