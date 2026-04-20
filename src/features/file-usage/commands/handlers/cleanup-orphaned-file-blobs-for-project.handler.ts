import { Injectable } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { CleanupOrphanedFileBlobsForProjectCommand } from 'src/features/file-usage/commands/impl/cleanup-orphaned-file-blobs-for-project.command';
import {
  FileBlobCleanupService,
  OrphanBlobRow,
} from 'src/features/file-usage/services/file-blob-cleanup.service';
import { CleanupOrphanedFileBlobsResult } from 'src/features/file-usage/types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@Injectable()
@CommandHandler(CleanupOrphanedFileBlobsForProjectCommand)
export class CleanupOrphanedFileBlobsForProjectHandler implements ICommandHandler<
  CleanupOrphanedFileBlobsForProjectCommand,
  CleanupOrphanedFileBlobsResult
> {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly transactionPrisma: TransactionPrismaService,
    private readonly cleanup: FileBlobCleanupService,
  ) {}

  async execute({
    data,
  }: CleanupOrphanedFileBlobsForProjectCommand): Promise<CleanupOrphanedFileBlobsResult> {
    const orphans = await this.findOrphansForProject(data.projectId);
    return this.cleanup.finalizeForSingleProject(data.projectId, orphans);
  }

  private async findOrphansForProject(
    projectId: string,
  ): Promise<OrphanBlobRow[]> {
    return this.prisma.fileBlob.findMany({
      where: {
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
