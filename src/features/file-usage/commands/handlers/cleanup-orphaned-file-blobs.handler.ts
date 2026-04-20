import { Injectable } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { CleanupOrphanedFileBlobsCommand } from 'src/features/file-usage/commands/impl/cleanup-orphaned-file-blobs.command';
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
@CommandHandler(CleanupOrphanedFileBlobsCommand)
export class CleanupOrphanedFileBlobsHandler implements ICommandHandler<
  CleanupOrphanedFileBlobsCommand,
  CleanupOrphanedFileBlobsResult
> {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly transactionPrisma: TransactionPrismaService,
  ) {}

  async execute(): Promise<CleanupOrphanedFileBlobsResult> {
    const orphans = await this.findOrphans();

    if (orphans.length === 0) {
      return this.emptyResult();
    }

    const bytesByProject = this.groupBytesByProject(orphans);
    const orphanIds = orphans.map((orphan) => orphan.id);
    const hashesInScope = this.uniqueHashes(orphans);

    await this.tombstoneOrphans(orphanIds);
    await this.decrementProjectCounters(bytesByProject);

    const orphanHashes = await this.findGloballyOrphanHashes(hashesInScope);

    return {
      blobsTombstoned: orphans.length,
      bytesFreed: this.sumBytes(bytesByProject),
      orphanHashes,
    };
  }

  private async findOrphans(): Promise<OrphanBlobRow[]> {
    return this.prisma.fileBlob.findMany({
      where: { deletedAt: null, rows: { none: {} } },
      select: { id: true, projectId: true, hash: true, size: true },
    });
  }

  private emptyResult(): CleanupOrphanedFileBlobsResult {
    return { blobsTombstoned: 0, bytesFreed: ZERO_BYTES, orphanHashes: [] };
  }

  private groupBytesByProject(
    orphans: readonly OrphanBlobRow[],
  ): Map<string, bigint> {
    const bytesByProject = new Map<string, bigint>();
    for (const orphan of orphans) {
      const current = bytesByProject.get(orphan.projectId) ?? ZERO_BYTES;
      bytesByProject.set(orphan.projectId, current + orphan.size);
    }
    return bytesByProject;
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

  private async decrementProjectCounters(
    bytesByProject: Map<string, bigint>,
  ): Promise<void> {
    for (const [projectId, freed] of bytesByProject) {
      await this.prisma.projectFileUsage.upsert({
        where: { projectId },
        create: { projectId, fileBytes: ZERO_BYTES },
        update: { fileBytes: { decrement: freed } },
      });
    }
  }

  private async findGloballyOrphanHashes(
    candidateHashes: readonly string[],
  ): Promise<string[]> {
    if (candidateHashes.length === 0) {
      return [];
    }

    const activeElsewhere = await this.prisma.fileBlob.findMany({
      where: { hash: { in: [...candidateHashes] }, deletedAt: null },
      select: { hash: true },
      distinct: ['hash'],
    });
    const stillActive = new Set(activeElsewhere.map((row) => row.hash));

    return candidateHashes.filter((hash) => !stillActive.has(hash));
  }

  private sumBytes(bytesByProject: Map<string, bigint>): bigint {
    return Array.from(bytesByProject.values()).reduce(
      (acc, value) => acc + value,
      ZERO_BYTES,
    );
  }

  private get prisma() {
    return this.transactionPrisma.getTransactionUnsafe() ?? this.prismaService;
  }
}
