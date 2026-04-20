import { Injectable } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { CleanupProjectFileUsageCommand } from 'src/features/file-usage/commands/impl/cleanup-project-file-usage.command';
import {
  FileBlobCleanupService,
  OrphanBlobRow,
} from 'src/features/file-usage/services/file-blob-cleanup.service';
import { CleanupProjectFileUsageResult } from 'src/features/file-usage/types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

const PRISMA_NOT_FOUND = 'P2025';

@Injectable()
@CommandHandler(CleanupProjectFileUsageCommand)
export class CleanupProjectFileUsageHandler implements ICommandHandler<
  CleanupProjectFileUsageCommand,
  CleanupProjectFileUsageResult
> {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly transactionPrisma: TransactionPrismaService,
    private readonly cleanup: FileBlobCleanupService,
  ) {}

  async execute({
    data,
  }: CleanupProjectFileUsageCommand): Promise<CleanupProjectFileUsageResult> {
    const activeBlobs = await this.findActiveBlobsForProject(data.projectId);
    const tombstoned = await this.cleanup.tombstoneActive(activeBlobs);

    await this.deleteUsageCounter(data.projectId);

    const orphanHashes = await this.cleanup.findGloballyOrphanHashes(
      this.cleanup.uniqueHashes(tombstoned),
    );

    return {
      projectId: data.projectId,
      blobsTombstoned: tombstoned.length,
      bytesFreed: this.cleanup.sumBytes(tombstoned),
      orphanHashes,
    };
  }

  private async findActiveBlobsForProject(
    projectId: string,
  ): Promise<OrphanBlobRow[]> {
    return this.prisma.fileBlob.findMany({
      where: { projectId, deletedAt: null },
      select: { id: true, projectId: true, hash: true, size: true },
    });
  }

  private async deleteUsageCounter(projectId: string): Promise<void> {
    await this.prisma.projectFileUsage
      .delete({ where: { projectId } })
      .catch((error: Error & { code?: string }) => {
        if (error.code !== PRISMA_NOT_FOUND) {
          throw error;
        }
      });
  }

  private get prisma() {
    return this.transactionPrisma.getTransactionUnsafe() ?? this.prismaService;
  }
}
