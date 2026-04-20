import { Injectable } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { CleanupProjectFileUsageCommand } from 'src/features/file-usage/commands/impl/cleanup-project-file-usage.command';
import { CleanupProjectFileUsageResult } from 'src/features/file-usage/types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

const ZERO_BYTES: bigint = BigInt(0);

interface ProjectBlobRow {
  id: string;
  hash: string;
  size: bigint;
}

@Injectable()
@CommandHandler(CleanupProjectFileUsageCommand)
export class CleanupProjectFileUsageHandler implements ICommandHandler<
  CleanupProjectFileUsageCommand,
  CleanupProjectFileUsageResult
> {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly transactionPrisma: TransactionPrismaService,
  ) {}

  async execute({
    data,
  }: CleanupProjectFileUsageCommand): Promise<CleanupProjectFileUsageResult> {
    const activeBlobs = await this.findActiveBlobsForProject(data.projectId);
    const bytesFreed = this.sumBytes(activeBlobs);
    const blobIds = activeBlobs.map((blob) => blob.id);
    const hashesInScope = this.uniqueHashes(activeBlobs);

    await this.tombstoneBlobs(blobIds);
    await this.deleteUsageCounter(data.projectId);

    const orphanHashes = await this.findGloballyOrphanHashes(hashesInScope);

    return {
      projectId: data.projectId,
      blobsTombstoned: activeBlobs.length,
      bytesFreed,
      orphanHashes,
    };
  }

  private async findActiveBlobsForProject(
    projectId: string,
  ): Promise<ProjectBlobRow[]> {
    return this.prisma.fileBlob.findMany({
      where: { projectId, deletedAt: null },
      select: { id: true, hash: true, size: true },
    });
  }

  private sumBytes(blobs: readonly ProjectBlobRow[]): bigint {
    return blobs.reduce((acc, blob) => acc + blob.size, ZERO_BYTES);
  }

  private uniqueHashes(blobs: readonly ProjectBlobRow[]): string[] {
    return Array.from(new Set(blobs.map((blob) => blob.hash)));
  }

  private async tombstoneBlobs(blobIds: readonly string[]): Promise<void> {
    if (blobIds.length === 0) {
      return;
    }

    await this.prisma.fileBlob.updateMany({
      where: { id: { in: [...blobIds] } },
      data: { deletedAt: new Date() },
    });
  }

  private async deleteUsageCounter(projectId: string): Promise<void> {
    await this.prisma.projectFileUsage
      .delete({ where: { projectId } })
      .catch((error: Error & { code?: string }) => {
        if (error.code !== 'P2025') {
          throw error;
        }
      });
  }

  private async findGloballyOrphanHashes(
    candidateHashes: readonly string[],
  ): Promise<string[]> {
    if (candidateHashes.length === 0) {
      return [];
    }

    const stillActive = await this.prisma.fileBlob.findMany({
      where: {
        hash: { in: [...candidateHashes] },
        deletedAt: null,
      },
      select: { hash: true },
      distinct: ['hash'],
    });
    const activeSet = new Set(stillActive.map((row) => row.hash));

    return candidateHashes.filter((hash) => !activeSet.has(hash));
  }

  private get prisma() {
    return this.transactionPrisma.getTransactionUnsafe() ?? this.prismaService;
  }
}
