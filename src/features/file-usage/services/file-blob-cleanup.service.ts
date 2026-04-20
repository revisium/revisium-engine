import { Injectable, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(FileBlobCleanupService.name);

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

    const tombstoned = await this.tombstoneActive(orphans);
    if (tombstoned.length === 0) {
      return this.emptyResult();
    }

    const bytesFreed = this.sumBytes(tombstoned);
    await this.decrementProjectCounter(projectId, bytesFreed);

    const orphanHashes = await this.findGloballyOrphanHashes(
      this.uniqueHashes(tombstoned),
    );

    return {
      blobsTombstoned: tombstoned.length,
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

    const tombstoned = await this.tombstoneActive(orphans);
    if (tombstoned.length === 0) {
      return this.emptyResult();
    }

    await this.decrementProjectCounters(this.groupBytesByProject(tombstoned));

    const orphanHashes = await this.findGloballyOrphanHashes(
      this.uniqueHashes(tombstoned),
    );

    return {
      blobsTombstoned: tombstoned.length,
      bytesFreed: this.sumBytes(tombstoned),
      orphanHashes,
    };
  }

  public sumBytes(orphans: readonly OrphanBlobRow[]): bigint {
    return orphans.reduce((acc, blob) => acc + blob.size, ZERO_BYTES);
  }

  public uniqueHashes(orphans: readonly OrphanBlobRow[]): string[] {
    return Array.from(new Set(orphans.map((orphan) => orphan.hash)));
  }

  public async tombstoneActive(
    orphans: readonly OrphanBlobRow[],
  ): Promise<OrphanBlobRow[]> {
    if (orphans.length === 0) {
      return [];
    }

    const marker = new Date();
    const ids = orphans.map((orphan) => orphan.id);

    const { count } = await this.prisma.fileBlob.updateMany({
      where: { id: { in: ids }, deletedAt: null },
      data: { deletedAt: marker },
    });

    if (count === 0) {
      return [];
    }

    const stamped = await this.prisma.fileBlob.findMany({
      where: { id: { in: ids }, deletedAt: marker },
      select: { id: true, projectId: true, hash: true, size: true },
    });

    return stamped;
  }

  public async decrementProjectCounter(
    projectId: string,
    amount: bigint,
  ): Promise<void> {
    if (amount === ZERO_BYTES) {
      return;
    }

    const wasDecremented = await this.tryDecrementProjectCounter(
      projectId,
      amount,
    );
    if (wasDecremented) {
      return;
    }

    await this.ensureNonNegativeProjectCounter(projectId, amount);
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

  private async tryDecrementProjectCounter(
    projectId: string,
    amount: bigint,
  ): Promise<boolean> {
    const result = await this.prisma.projectFileUsage.updateMany({
      where: {
        projectId,
        fileBytes: { gte: amount },
      },
      data: {
        fileBytes: { decrement: amount },
      },
    });

    return result.count === 1;
  }

  private async ensureNonNegativeProjectCounter(
    projectId: string,
    amount: bigint,
  ): Promise<void> {
    const usage = await this.prisma.projectFileUsage.findUnique({
      where: { projectId },
    });
    if (!usage) {
      await this.prisma.projectFileUsage.create({
        data: {
          projectId,
          fileBytes: ZERO_BYTES,
        },
      });

      return;
    }

    await this.clampProjectCounter(projectId, usage.fileBytes, amount);
  }

  private async clampProjectCounter(
    projectId: string,
    current: bigint,
    requested: bigint,
  ): Promise<void> {
    await this.prisma.projectFileUsage.update({
      where: { projectId },
      data: { fileBytes: ZERO_BYTES },
    });

    this.logger.warn({
      message: 'Clamped project file usage over-decrement to zero',
      projectId,
      current,
      requested,
    });
  }

  private get prisma() {
    return this.transactionPrisma.getTransactionUnsafe() ?? this.prismaService;
  }
}
