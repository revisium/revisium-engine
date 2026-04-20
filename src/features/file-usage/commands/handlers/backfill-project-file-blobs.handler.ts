import { Injectable, Logger } from '@nestjs/common';
import { CommandBus, CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { JsonSchemaStore } from '@revisium/schema-toolkit/model';
import { JsonValue } from '@revisium/schema-toolkit/types';
import { BackfillProjectFileBlobsCommand } from 'src/features/file-usage/commands/impl/backfill-project-file-blobs.command';
import { RestoreProjectFileBytesCommand } from 'src/features/file-usage/commands/impl/restore-project-file-bytes.command';
import { FileReferenceExtractorService } from 'src/features/file-usage/services/file-reference-extractor.service';
import {
  BackfillProjectFileBlobsResult,
  RestoreProjectFileBytesResult,
} from 'src/features/file-usage/types';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { ShareTransactionalQueries } from 'src/features/share/share.transactional.queries';
import { systemTablesIds } from 'src/features/share/system-tables.consts';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

const ZERO_BYTES: bigint = BigInt(0);
const ZERO_INT = 0;

interface PlannedBlob {
  size: bigint;
  rowVersionIds: Set<string>;
}

interface BackfillScanResult {
  scannedRowVersions: number;
  plannedBlobs: Map<string, PlannedBlob>;
}

@Injectable()
@CommandHandler(BackfillProjectFileBlobsCommand)
export class BackfillProjectFileBlobsHandler implements ICommandHandler<
  BackfillProjectFileBlobsCommand,
  BackfillProjectFileBlobsResult
> {
  private readonly logger = new Logger(BackfillProjectFileBlobsHandler.name);

  constructor(
    private readonly commandBus: CommandBus,
    private readonly prismaService: PrismaService,
    private readonly transactionPrisma: TransactionPrismaService,
    private readonly shareTransactionalQueries: ShareTransactionalQueries,
    private readonly jsonSchemaStore: JsonSchemaStoreService,
    private readonly extractor: FileReferenceExtractorService,
  ) {}

  async execute({
    data,
  }: BackfillProjectFileBlobsCommand): Promise<BackfillProjectFileBlobsResult> {
    const dryRun = data.dryRun === true;
    const scan = await this.scanProjectForBlobs(data.projectId);

    if (dryRun) {
      return this.buildDryRunResult(data.projectId, scan);
    }

    return this.applyBackfill(data.projectId, scan);
  }

  private async scanProjectForBlobs(
    projectId: string,
  ): Promise<BackfillScanResult> {
    const branches = await this.findBranchIdsForProject(projectId);
    const context = this.createScanContext();

    for (const branchId of branches) {
      await this.scanBranch(branchId, context);
    }

    return {
      scannedRowVersions: context.scannedRowVersions,
      plannedBlobs: context.plannedBlobs,
    };
  }

  private async findBranchIdsForProject(projectId: string): Promise<string[]> {
    const branches = await this.prisma.branch.findMany({
      where: { projectId },
      select: { id: true },
    });
    return branches.map((branch) => branch.id);
  }

  private createScanContext() {
    return {
      seenRowVersionKeys: new Set<string>(),
      plannedBlobs: new Map<string, PlannedBlob>(),
      scannedRowVersions: 0,
    };
  }

  private async scanBranch(
    branchId: string,
    context: ReturnType<BackfillProjectFileBlobsHandler['createScanContext']>,
  ): Promise<void> {
    const revisions = await this.prisma.revision.findMany({
      where: { branchId },
      select: { id: true },
    });

    for (const revision of revisions) {
      context.scannedRowVersions += await this.scanRevisionForBlobs({
        revisionId: revision.id,
        seenRowVersionKeys: context.seenRowVersionKeys,
        plannedBlobs: context.plannedBlobs,
      });
    }
  }

  private async scanRevisionForBlobs(args: {
    revisionId: string;
    seenRowVersionKeys: Set<string>;
    plannedBlobs: Map<string, PlannedBlob>;
  }): Promise<number> {
    const tables = await this.findNonSystemTablesForRevision(args.revisionId);
    let scanned = 0;

    for (const table of tables) {
      const schemaStore = await this.loadSchemaSafe(args.revisionId, table.id);

      if (!schemaStore) {
        continue;
      }

      scanned += await this.scanTableForBlobs({
        tableVersionId: table.versionId,
        schemaStore,
        seenRowVersionKeys: args.seenRowVersionKeys,
        plannedBlobs: args.plannedBlobs,
      });
    }

    return scanned;
  }

  private async findNonSystemTablesForRevision(revisionId: string) {
    const tables = await this.prisma.table.findMany({
      where: { revisions: { some: { id: revisionId } } },
      select: { versionId: true, id: true },
    });
    return tables.filter((table) => !systemTablesIds.includes(table.id));
  }

  private async loadSchemaSafe(
    revisionId: string,
    tableId: string,
  ): Promise<JsonSchemaStore | null> {
    try {
      const schema = await this.shareTransactionalQueries.getTableSchema(
        revisionId,
        tableId,
      );
      return this.jsonSchemaStore.create(schema.schema);
    } catch (error) {
      this.logger.warn(
        `Unable to resolve schema for revisionId=${revisionId} tableId=${tableId}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private async scanTableForBlobs(args: {
    tableVersionId: string;
    schemaStore: JsonSchemaStore;
    seenRowVersionKeys: Set<string>;
    plannedBlobs: Map<string, PlannedBlob>;
  }): Promise<number> {
    const rows = await this.prisma.row.findMany({
      where: { tables: { some: { versionId: args.tableVersionId } } },
      select: { versionId: true, id: true, data: true },
    });

    let scanned = 0;

    for (const row of rows) {
      const key = `${args.tableVersionId}:${row.versionId}`;

      if (args.seenRowVersionKeys.has(key)) {
        continue;
      }

      args.seenRowVersionKeys.add(key);
      scanned += 1;

      this.mergeRowReferences({
        rowVersionId: row.versionId,
        rowId: row.id,
        rowData: row.data as JsonValue,
        schemaStore: args.schemaStore,
        plannedBlobs: args.plannedBlobs,
      });
    }

    return scanned;
  }

  private mergeRowReferences(args: {
    rowVersionId: string;
    rowId: string;
    rowData: JsonValue;
    schemaStore: JsonSchemaStore;
    plannedBlobs: Map<string, PlannedBlob>;
  }): void {
    const refs = this.extractor.extract({
      data: args.rowData,
      schemaStore: args.schemaStore,
      rowId: args.rowId,
    });

    for (const ref of refs) {
      const existing = args.plannedBlobs.get(ref.hash);
      if (existing) {
        existing.rowVersionIds.add(args.rowVersionId);
      } else {
        args.plannedBlobs.set(ref.hash, {
          size: ref.size,
          rowVersionIds: new Set([args.rowVersionId]),
        });
      }
    }
  }

  private buildDryRunResult(
    projectId: string,
    scan: BackfillScanResult,
  ): BackfillProjectFileBlobsResult {
    const plannedBlobsArray = Array.from(scan.plannedBlobs.values());
    const fileBytesAfter = plannedBlobsArray.reduce(
      (acc, blob) => acc + blob.size,
      ZERO_BYTES,
    );
    const referencesCreated = plannedBlobsArray.reduce(
      (acc, blob) => acc + blob.rowVersionIds.size,
      ZERO_INT,
    );

    return {
      projectId,
      scannedRowVersions: scan.scannedRowVersions,
      blobsCreated: scan.plannedBlobs.size,
      referencesCreated,
      fileBytesAfter,
      dryRun: true,
    };
  }

  private async applyBackfill(
    projectId: string,
    scan: BackfillScanResult,
  ): Promise<BackfillProjectFileBlobsResult> {
    const outcome = await this.persistPlannedBlobs(
      projectId,
      scan.plannedBlobs,
    );
    const restored = await this.restoreProjectFileBytes(projectId);

    return {
      projectId,
      scannedRowVersions: scan.scannedRowVersions,
      blobsCreated: outcome.blobsCreated,
      referencesCreated: outcome.referencesCreated,
      fileBytesAfter: restored.nextFileBytes,
      dryRun: false,
    };
  }

  private async persistPlannedBlobs(
    projectId: string,
    plannedBlobs: Map<string, PlannedBlob>,
  ): Promise<{ blobsCreated: number; referencesCreated: number }> {
    let blobsCreated = 0;
    let referencesCreated = 0;

    for (const [hash, planned] of plannedBlobs) {
      const blob = await this.upsertBlob({
        projectId,
        hash,
        size: planned.size,
      });

      if (!blob) {
        continue;
      }

      if (blob.wasCreated) {
        blobsCreated += 1;
      }

      referencesCreated += await this.linkRowVersions(
        blob.id,
        planned.rowVersionIds,
      );
    }

    return { blobsCreated, referencesCreated };
  }

  private async upsertBlob(args: {
    projectId: string;
    hash: string;
    size: bigint;
  }): Promise<{ id: string; wasCreated: boolean } | null> {
    const { count } = await this.prisma.fileBlob.createMany({
      data: [
        {
          projectId: args.projectId,
          hash: args.hash,
          size: args.size,
        },
      ],
      skipDuplicates: true,
    });

    if (count === 1) {
      const created = await this.prisma.fileBlob.findUnique({
        where: {
          projectId_hash: { projectId: args.projectId, hash: args.hash },
        },
        select: { id: true },
      });
      if (!created) {
        this.logger.warn(
          `Backfill inserted FileBlob but could not locate it for projectId=${args.projectId} hash=${args.hash}`,
        );
        return null;
      }
      return { id: created.id, wasCreated: true };
    }

    return this.locateAndReactivateBlob(args.projectId, args.hash);
  }

  private async locateAndReactivateBlob(
    projectId: string,
    hash: string,
  ): Promise<{ id: string; wasCreated: boolean } | null> {
    const existing = await this.prisma.fileBlob.findUnique({
      where: { projectId_hash: { projectId, hash } },
      select: { id: true, deletedAt: true },
    });

    if (!existing) {
      this.logger.warn(
        `Backfill failed to locate FileBlob for projectId=${projectId} hash=${hash}`,
      );
      return null;
    }

    if (existing.deletedAt !== null) {
      await this.prisma.fileBlob.update({
        where: { id: existing.id },
        data: { deletedAt: null },
      });
    }

    return { id: existing.id, wasCreated: false };
  }

  private async linkRowVersions(
    blobId: string,
    rowVersionIds: Set<string>,
  ): Promise<number> {
    if (rowVersionIds.size === 0) {
      return 0;
    }

    const missing = await this.filterMissingLinks(blobId, rowVersionIds);
    if (missing.length === 0) {
      return 0;
    }

    await this.prisma.fileBlob.update({
      where: { id: blobId },
      data: {
        rows: {
          connect: missing.map((versionId) => ({ versionId })),
        },
      },
      select: { id: true },
    });

    return missing.length;
  }

  private async filterMissingLinks(
    blobId: string,
    rowVersionIds: Set<string>,
  ): Promise<string[]> {
    const blob = await this.prisma.fileBlob.findUnique({
      where: { id: blobId },
      select: {
        rows: {
          where: { versionId: { in: [...rowVersionIds] } },
          select: { versionId: true },
        },
      },
    });

    const existing = new Set(blob?.rows.map((row) => row.versionId) ?? []);
    return [...rowVersionIds].filter((versionId) => !existing.has(versionId));
  }

  private restoreProjectFileBytes(
    projectId: string,
  ): Promise<RestoreProjectFileBytesResult> {
    return this.commandBus.execute(
      new RestoreProjectFileBytesCommand({ projectId }),
    );
  }

  private get prisma() {
    return this.transactionPrisma.getTransactionUnsafe() ?? this.prismaService;
  }
}
