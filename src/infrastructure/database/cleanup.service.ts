import { Injectable, Logger, Optional } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { CleanupOrphanedFileBlobsCommand } from 'src/features/file-usage/commands/impl/cleanup-orphaned-file-blobs.command';
import { CleanupOrphanedFileBlobsResult } from 'src/features/file-usage/types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';

const ZERO_BYTES: bigint = BigInt(0);

export interface CleanOrphanedDataResult {
  tables: number;
  rows: number;
  fileBlobsTombstoned: number;
  fileBytesFreed: bigint;
  orphanHashes: string[];
}

@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly commandBus?: CommandBus,
  ) {}

  async cleanOrphanedData(): Promise<CleanOrphanedDataResult> {
    const tables = await this.deleteOrphanTables();
    const rows = await this.deleteOrphanRows();
    const fileBlobCleanup = await this.sweepOrphanFileBlobs();

    return {
      tables,
      rows,
      fileBlobsTombstoned: fileBlobCleanup.blobsTombstoned,
      fileBytesFreed: fileBlobCleanup.bytesFreed,
      orphanHashes: fileBlobCleanup.orphanHashes,
    };
  }

  private async deleteOrphanTables(): Promise<number> {
    const result = await this.prisma.table.deleteMany({
      where: { revisions: { none: {} } },
    });

    if (result.count) {
      this.logger.log(`Deleted ${result.count} orphaned tables`);
    }

    return result.count;
  }

  private async deleteOrphanRows(): Promise<number> {
    const result = await this.prisma.row.deleteMany({
      where: { tables: { none: {} } },
    });

    if (result.count) {
      this.logger.log(`Deleted ${result.count} orphaned rows`);
    }

    return result.count;
  }

  private async sweepOrphanFileBlobs(): Promise<CleanupOrphanedFileBlobsResult> {
    if (!this.commandBus) {
      return this.emptyFileBlobResult();
    }

    const result = await this.executeFileBlobCleanup();

    if (result.blobsTombstoned) {
      this.logger.log(
        `Tombstoned ${result.blobsTombstoned} orphan file blobs (${result.bytesFreed} bytes freed)`,
      );
    }

    return result;
  }

  private async executeFileBlobCleanup(): Promise<CleanupOrphanedFileBlobsResult> {
    const commandBus = this.commandBus;
    if (!commandBus) {
      return this.emptyFileBlobResult();
    }

    try {
      return await commandBus.execute(new CleanupOrphanedFileBlobsCommand());
    } catch (error) {
      if (this.isMissingHandlerError(error)) {
        return this.emptyFileBlobResult();
      }
      throw error;
    }
  }

  private isMissingHandlerError(error: unknown): boolean {
    const message = (error as Error).message ?? '';
    return message.includes('No handler found for the command');
  }

  private emptyFileBlobResult(): CleanupOrphanedFileBlobsResult {
    return { blobsTombstoned: 0, bytesFreed: ZERO_BYTES, orphanHashes: [] };
  }
}
