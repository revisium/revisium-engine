import { Injectable, Logger } from '@nestjs/common';
import { CommandBus, CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { JsonSchemaStore } from '@revisium/schema-toolkit/model';
import { JsonValue } from '@revisium/schema-toolkit/types';
import { CleanupFileBlobsByIdsCommand } from 'src/features/file-usage/commands/impl/cleanup-file-blobs-by-ids.command';
import {
  RegisterFileReferencesForRowsCommand,
  RegisterFileReferencesRowInput,
} from 'src/features/file-usage/commands/impl/register-file-references-for-rows.command';
import { FileReferenceExtractorService } from 'src/features/file-usage/services/file-reference-extractor.service';
import { FileReference } from 'src/features/file-usage/types';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { ShareTransactionalQueries } from 'src/features/share/share.transactional.queries';
import { systemTablesIds } from 'src/features/share/system-tables.consts';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@Injectable()
@CommandHandler(RegisterFileReferencesForRowsCommand)
export class RegisterFileReferencesForRowsHandler implements ICommandHandler<
  RegisterFileReferencesForRowsCommand,
  void
> {
  private readonly logger = new Logger(
    RegisterFileReferencesForRowsHandler.name,
  );

  constructor(
    private readonly commandBus: CommandBus,
    private readonly prismaService: PrismaService,
    private readonly transactionPrisma: TransactionPrismaService,
    private readonly shareTransactionalQueries: ShareTransactionalQueries,
    private readonly jsonSchemaStore: JsonSchemaStoreService,
    private readonly extractor: FileReferenceExtractorService,
  ) {}

  async execute({ data }: RegisterFileReferencesForRowsCommand): Promise<void> {
    if (!this.shouldProcess(data.rows, data.tableId)) {
      return;
    }

    const projectId = await this.resolveProjectId(data.revisionId);
    if (!projectId) {
      return;
    }

    const schemaStore = await this.loadSchemaStore(
      data.revisionId,
      data.tableId,
    );

    for (const row of data.rows) {
      await this.registerReferencesForRow(projectId, row, schemaStore);
    }
  }

  private shouldProcess(
    rows: readonly RegisterFileReferencesRowInput[],
    tableId: string,
  ): boolean {
    if (rows.length === 0) {
      return false;
    }

    if (systemTablesIds.includes(tableId)) {
      return false;
    }

    return true;
  }

  private async resolveProjectId(revisionId: string): Promise<string | null> {
    const revision = await this.prisma.revision.findUnique({
      where: { id: revisionId },
      select: { branch: { select: { projectId: true } } },
    });

    return revision?.branch.projectId ?? null;
  }

  private async loadSchemaStore(
    revisionId: string,
    tableId: string,
  ): Promise<JsonSchemaStore> {
    const schemaResult = await this.shareTransactionalQueries.getTableSchema(
      revisionId,
      tableId,
    );

    return this.jsonSchemaStore.create(schemaResult.schema);
  }

  private async registerReferencesForRow(
    projectId: string,
    row: RegisterFileReferencesRowInput,
    schemaStore: JsonSchemaStore,
  ): Promise<void> {
    const references = this.extractor.extract({
      data: row.data as JsonValue,
      schemaStore,
      rowId: row.rowId,
    });

    const existing = await this.loadExistingRowBlobLinks(row.rowVersionId);
    const referencedHashes = new Set(
      references.map((reference) => reference.hash),
    );
    const blobIdsToDisconnect = existing
      .filter((blob) => !referencedHashes.has(blob.hash))
      .map((blob) => blob.id);

    if (blobIdsToDisconnect.length > 0) {
      await this.disconnectBlobsFromRowVersion(
        row.rowVersionId,
        blobIdsToDisconnect,
      );
    }

    for (const reference of references) {
      await this.registerOneReference({
        projectId,
        rowVersionId: row.rowVersionId,
        reference,
        existing,
      });
    }

    if (blobIdsToDisconnect.length > 0) {
      await this.commandBus.execute(
        new CleanupFileBlobsByIdsCommand({
          projectId,
          blobIds: blobIdsToDisconnect,
        }),
      );
    }
  }

  private async registerOneReference(args: {
    projectId: string;
    rowVersionId: string;
    reference: FileReference;
    existing: RowBlobLink[];
  }): Promise<void> {
    const existingBlob = args.existing.find(
      (blob) => blob.hash === args.reference.hash,
    );

    if (existingBlob) {
      this.warnOnSizeMismatch(
        args.projectId,
        args.reference,
        existingBlob.size,
      );

      if (existingBlob.deletedAt !== null) {
        await this.reactivateBlob(existingBlob.id);
        await this.incrementProjectCounter(args.projectId, existingBlob.size);
      }
      return;
    }

    const blobId = await this.ensureActiveBlob(args.projectId, args.reference);

    if (!blobId) {
      return;
    }

    await this.linkBlobToRowVersion(blobId, args.rowVersionId);
  }

  private async loadExistingRowBlobLinks(
    rowVersionId: string,
  ): Promise<RowBlobLink[]> {
    const row = await this.prisma.row.findUnique({
      where: { versionId: rowVersionId },
      select: {
        fileBlobs: {
          select: { id: true, hash: true, size: true, deletedAt: true },
        },
      },
    });

    return row?.fileBlobs ?? [];
  }

  private async disconnectBlobsFromRowVersion(
    rowVersionId: string,
    blobIds: readonly string[],
  ): Promise<void> {
    await this.prisma.row.update({
      where: { versionId: rowVersionId },
      data: {
        fileBlobs: {
          disconnect: blobIds.map((id) => ({ id })),
        },
      },
      select: { versionId: true },
    });
  }

  private async ensureActiveBlob(
    projectId: string,
    reference: FileReference,
  ): Promise<string | null> {
    const { count } = await this.prisma.fileBlob.createMany({
      data: [
        {
          projectId,
          hash: reference.hash,
          size: reference.size,
        },
      ],
      skipDuplicates: true,
    });

    const existing = await this.prisma.fileBlob.findUnique({
      where: { projectId_hash: { projectId, hash: reference.hash } },
      select: { id: true, size: true, deletedAt: true },
    });

    if (!existing) {
      this.logger.warn(
        `FileBlob for projectId=${projectId} hash=${reference.hash} disappeared between insert and lookup`,
      );
      return null;
    }

    if (count === 1) {
      await this.incrementProjectCounter(projectId, reference.size);
      return existing.id;
    }

    this.warnOnSizeMismatch(projectId, reference, existing.size);

    if (existing.deletedAt !== null) {
      await this.reactivateBlob(existing.id);
      await this.incrementProjectCounter(projectId, existing.size);
    }

    return existing.id;
  }

  private warnOnSizeMismatch(
    projectId: string,
    reference: FileReference,
    existingSize: bigint,
  ): void {
    if (existingSize !== reference.size) {
      this.logger.warn(
        `FileBlob size mismatch for projectId=${projectId} hash=${reference.hash}: existing=${existingSize} incoming=${reference.size}`,
      );
    }
  }

  private async reactivateBlob(blobId: string): Promise<void> {
    await this.prisma.fileBlob.update({
      where: { id: blobId },
      data: { deletedAt: null },
    });
  }

  private async incrementProjectCounter(
    projectId: string,
    delta: bigint,
  ): Promise<void> {
    await this.prisma.projectFileUsage.upsert({
      where: { projectId },
      create: { projectId, fileBytes: delta },
      update: { fileBytes: { increment: delta } },
    });
  }

  private async linkBlobToRowVersion(
    blobId: string,
    rowVersionId: string,
  ): Promise<void> {
    await this.prisma.fileBlob.update({
      where: { id: blobId },
      data: { rows: { connect: { versionId: rowVersionId } } },
      select: { id: true },
    });
  }

  private get prisma() {
    return this.transactionPrisma.getTransactionUnsafe() ?? this.prismaService;
  }
}

interface RowBlobLink {
  id: string;
  hash: string;
  size: bigint;
  deletedAt: Date | null;
}
