import { Injectable } from '@nestjs/common';
import { CleanupOrphanedFileBlobsResult } from 'src/features/file-usage/types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

const ZERO_BYTES: bigint = BigInt(0);

export interface OrphanBlobRow {
  id: string;
  projectId: string;
  hash: string;
  size: bigint;
}

@Injectable()
export class FileBlobCleanupService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly transactionPrisma: TransactionPrismaService,
  ) {}

  public emptyResult(): CleanupOrphanedFileBlobsResult {
    return { blobsTombstoned: 0, bytesFreed: ZERO_BYTES, orphanHashes: [] };
  }

  public async finalizeForSingleProject(
    projectId: string,
    orphans: readonly OrphanBlobRow[],
  ): Promise<CleanupOrphanedFileBlobsResult> {
    if (orphans.length === 0) {
      return this.emptyResult();
    }

    const bytesFreed = this.sumBytes(orphans);
    const orphanIds = orphans.map((orphan) => orphan.id);
    const hashesInScope = this.uniqueHashes(orphans);

    await this.tombstoneBlobs(orphanIds);
    await this.decrementProjectCounter(projectId, bytesFreed);

    const orphanHashes = await this.findGloballyOrphanHashes(hashesInScope);

    return {
      blobsTombstoned: orphans.length,
      bytesFreed,
      orphanHashes,
    };
  }

  public async finalizeAcrossProjects(
    orphans: readonly OrphanBlobRow[],
  ): Promise<CleanupOrphanedFileBlobsResult> {
    if (orphans.length === 0) {
      return this.emptyResult();
    }

    const bytesByProject = this.groupBytesByProject(orphans);
    const orphanIds = orphans.map((orphan) => orphan.id);
    const hashesInScope = this.uniqueHashes(orphans);

    await this.tombstoneBlobs(orphanIds);
    await this.decrementProjectCounters(bytesByProject);

    const orphanHashes = await this.findGloballyOrphanHashes(hashesInScope);

    return {
      blobsTombstoned: orphans.length,
      bytesFreed: this.sumBytes(orphans),
      orphanHashes,
    };
  }

  public sumBytes(orphans: readonly OrphanBlobRow[]): bigint {
    return orphans.reduce((acc, blob) => acc + blob.size, ZERO_BYTES);
  }

  public uniqueHashes(orphans: readonly OrphanBlobRow[]): string[] {
    return Array.from(new Set(orphans.map((orphan) => orphan.hash)));
  }

  public async tombstoneBlobs(blobIds: readonly string[]): Promise<void> {
    if (blobIds.length === 0) {
      return;
    }

    await this.prisma.fileBlob.updateMany({
      where: { id: { in: [...blobIds] } },
      data: { deletedAt: new Date() },
    });
  }

  public async decrementProjectCounter(
    projectId: string,
    amount: bigint,
  ): Promise<void> {
    await this.prisma.projectFileUsage.upsert({
      where: { projectId },
      create: { projectId, fileBytes: ZERO_BYTES },
      update: { fileBytes: { decrement: amount } },
    });
  }

  public async findGloballyOrphanHashes(
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

  private async decrementProjectCounters(
    bytesByProject: Map<string, bigint>,
  ): Promise<void> {
    for (const [projectId, freed] of bytesByProject) {
      await this.decrementProjectCounter(projectId, freed);
    }
  }

  private get prisma() {
    return this.transactionPrisma.getTransactionUnsafe() ?? this.prismaService;
  }
}
