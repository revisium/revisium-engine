import { Injectable } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { CleanupOrphanedFileBlobsCommand } from 'src/features/file-usage/commands/impl/cleanup-orphaned-file-blobs.command';
import {
  FileBlobCleanupService,
  OrphanBlobRow,
} from 'src/features/file-usage/services/file-blob-cleanup.service';
import { CleanupOrphanedFileBlobsResult } from 'src/features/file-usage/types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@Injectable()
@CommandHandler(CleanupOrphanedFileBlobsCommand)
export class CleanupOrphanedFileBlobsHandler implements ICommandHandler<
  CleanupOrphanedFileBlobsCommand,
  CleanupOrphanedFileBlobsResult
> {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly transactionPrisma: TransactionPrismaService,
    private readonly cleanup: FileBlobCleanupService,
  ) {}

  async execute(): Promise<CleanupOrphanedFileBlobsResult> {
    const orphans = await this.findOrphans();
    return this.cleanup.finalizeAcrossProjects(orphans);
  }

  private async findOrphans(): Promise<OrphanBlobRow[]> {
    return this.prisma.fileBlob.findMany({
      where: { deletedAt: null, rows: { none: {} } },
      select: { id: true, projectId: true, hash: true, size: true },
    });
  }

  private get prisma() {
    return this.transactionPrisma.getTransactionUnsafe() ?? this.prismaService;
  }
}
