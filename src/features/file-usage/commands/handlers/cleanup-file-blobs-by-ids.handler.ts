import { Injectable } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { CleanupFileBlobsByIdsCommand } from 'src/features/file-usage/commands/impl/cleanup-file-blobs-by-ids.command';
import { CleanupOrphanedFileBlobsResult } from 'src/features/file-usage/types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

const ZERO_BYTES: bigint = BigInt(0);

interface OrphanBlobRow {
  id: string;
  projectId: string;
  hash: string;
  size: bigint;
}

@Injectable()
@CommandHandler(CleanupFileBlobsByIdsCommand)
export class CleanupFileBlobsByIdsHandler implements ICommandHandler<
  CleanupFileBlobsByIdsCommand,
  CleanupOrphanedFileBlobsResult
> {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly transactionPrisma: TransactionPrismaService,
  ) {}

  async execute({
    data,
  }: CleanupFileBlobsByIdsCommand): Promise<CleanupOrphanedFileBlobsResult> {
    if (data.blobIds.length === 0) {
      return this.emptyResult();
    }

    const orphans = await this.findOrphansByIds(data.projectId, data.blobIds);
    if (orphans.length === 0) {
      return this.emptyResult();
    }

    const bytesFreed = this.sumBytes(orphans);
    const orphanIds = orphans.map((orphan) => orphan.id);
    const hashesInScope = this.uniqueHashes(orphans);

    await this.tombstoneOrphans(orphanIds);
    await this.decrementProjectCounter(data.projectId, bytesFreed);

    const orphanHashes = await this.findGloballyOrphanHashes(hashesInScope);

    return {
      blobsTombstoned: orphans.length,
      bytesFreed,
      orphanHashes,
    };
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

  private emptyResult(): CleanupOrphanedFileBlobsResult {
    return { blobsTombstoned: 0, bytesFreed: ZERO_BYTES, orphanHashes: [] };
  }

  private sumBytes(orphans: readonly OrphanBlobRow[]): bigint {
    return orphans.reduce((acc, blob) => acc + blob.size, ZERO_BYTES);
  }

  private uniqueHashes(orphans: readonly OrphanBlobRow[]): string[] {
    return Array.from(new Set(orphans.map((orphan) => orphan.hash)));
  }

  private async tombstoneOrphans(orphanIds: readonly string[]): Promise<void> {
    await this.prisma.fileBlob.updateMany({
      where: { id: { in: [...orphanIds] } },
      data: { deletedAt: new Date() },
    });
  }

  private async decrementProjectCounter(
    projectId: string,
    amount: bigint,
  ): Promise<void> {
    await this.prisma.projectFileUsage.upsert({
      where: { projectId },
      create: { projectId, fileBytes: ZERO_BYTES },
      update: { fileBytes: { decrement: amount } },
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
