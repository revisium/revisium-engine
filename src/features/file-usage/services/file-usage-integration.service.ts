import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { CleanupFileBlobsByIdsCommand } from 'src/features/file-usage/commands/impl/cleanup-file-blobs-by-ids.command';
import {
  RegisterFileReferencesForRowsCommand,
  RegisterFileReferencesForRowsCommandData,
} from 'src/features/file-usage/commands/impl/register-file-references-for-rows.command';
import {
  RegisterFileReferencesForRowVersionsCommand,
  RegisterFileReferencesForRowVersionsCommandData,
} from 'src/features/file-usage/commands/impl/register-file-references-for-row-versions.command';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@Injectable()
export class FileUsageIntegrationService {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly prismaService: PrismaService,
    private readonly transactionPrisma: TransactionPrismaService,
  ) {}

  public registerReferencesForRows(
    data: RegisterFileReferencesForRowsCommandData,
  ): Promise<void> {
    return this.commandBus.execute(
      new RegisterFileReferencesForRowsCommand(data),
    );
  }

  public registerReferencesForRowVersions(
    data: RegisterFileReferencesForRowVersionsCommandData,
  ): Promise<void> {
    return this.commandBus.execute(
      new RegisterFileReferencesForRowVersionsCommand(data),
    );
  }

  public async findBlobIdsLinkedToRows(args: {
    tableId: string;
    rowIds: readonly string[];
  }): Promise<string[]> {
    if (args.rowIds.length === 0) {
      return [];
    }

    const rows = await this.prisma.row.findMany({
      where: {
        id: { in: [...args.rowIds] },
        tables: { some: { id: args.tableId } },
      },
      select: { fileBlobs: { select: { id: true } } },
    });

    const blobIds = new Set<string>();
    for (const row of rows) {
      for (const blob of row.fileBlobs) {
        blobIds.add(blob.id);
      }
    }
    return [...blobIds];
  }

  public async cleanupBlobsByIds(args: {
    revisionId: string;
    blobIds: readonly string[];
  }): Promise<void> {
    if (args.blobIds.length === 0) {
      return;
    }

    const projectId = await this.resolveProjectId(args.revisionId);
    if (!projectId) {
      return;
    }

    await this.commandBus.execute(
      new CleanupFileBlobsByIdsCommand({ projectId, blobIds: args.blobIds }),
    );
  }

  private async resolveProjectId(revisionId: string): Promise<string | null> {
    const revision = await this.prisma.revision.findUnique({
      where: { id: revisionId },
      select: { branch: { select: { projectId: true } } },
    });
    return revision?.branch.projectId ?? null;
  }

  private get prisma() {
    return this.transactionPrisma.getTransactionUnsafe() ?? this.prismaService;
  }
}
