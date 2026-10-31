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
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { ShareTransactionalQueries } from 'src/features/share/share.transactional.queries';
import { systemTablesIds } from 'src/features/share/system-tables.consts';
import { IdService } from 'src/infrastructure/database/id.service';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

const ZERO_BYTES: bigint = BigInt(0);

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
    private readonly idService: IdService,
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
    const references = this.extractReferences(
      projectId,
      data.rows,
      schemaStore,
    );
    const linkedBlobs = await this.loadLinkedBlobs(data.rows);

    await this.registerReferences(projectId, references, linkedBlobs);
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

  private extractReferences(
    projectId: string,
    rows: readonly RegisterFileReferencesRowInput[],
    schemaStore: JsonSchemaStore,
  ): RowFileReference[] {
    return rows.flatMap((row) =>
      this.extractor
        .extract({
          data: row.data as JsonValue,
          schemaStore,
          rowId: row.rowId,
          projectId,
        })
        .map(({ hash, size }) => ({
          rowVersionId: row.rowVersionId,
          hash,
          size,
        })),
    );
  }

  private async registerReferences(
    projectId: string,
    references: RowFileReference[],
    linkedBlobs: LinkedBlob[],
  ): Promise<void> {
    const plan = planRowBlobLinks(references, linkedBlobs);

    await this.disconnectRowBlobLinks(plan.staleLinks);

    const createdBytes = await this.createMissingBlobs(
      projectId,
      plan.unlinkedReferences,
    );
    const newlyResolved = await this.resolveProjectBlobs(
      projectId,
      plan.unlinkedReferences,
    );
    const resolved = [...plan.linkedReferences, ...newlyResolved];

    this.warnOnSizeMismatches(projectId, resolved);

    const reactivatedBytes = await this.reactivateTombstonedBlobs(resolved);
    await this.incrementProjectCounter(
      projectId,
      createdBytes + reactivatedBytes,
    );

    await this.connectRowBlobLinks(newlyResolved);
    await this.cleanupDisconnectedBlobs(projectId, plan.staleLinks);
  }

  private loadLinkedBlobs(
    rows: readonly RegisterFileReferencesRowInput[],
  ): Promise<LinkedBlob[]> {
    const rowVersionIds = rows.map((row) => row.rowVersionId);

    return this.prisma.$queryRaw<LinkedBlob[]>`
      SELECT link."B" AS "rowVersionId", blob."id", blob."hash", blob."size"
      FROM "_FileBlobToRow" AS link
      JOIN "FileBlob" AS blob ON blob."id" = link."A"
      WHERE link."B" = ANY(${rowVersionIds}::text[])
    `;
  }

  private async disconnectRowBlobLinks(links: LinkedBlob[]): Promise<void> {
    if (links.length === 0) {
      return;
    }

    await this.prisma.$executeRaw`
      DELETE FROM "_FileBlobToRow" AS link
      USING unnest(
        ${links.map((link) => link.id)}::text[],
        ${links.map((link) => link.rowVersionId)}::text[]
      ) AS stale("blobId", "rowVersionId")
      WHERE link."A" = stale."blobId" AND link."B" = stale."rowVersionId"
    `;
  }

  private async createMissingBlobs(
    projectId: string,
    references: RowFileReference[],
  ): Promise<bigint> {
    const candidates = firstReferencePerHash(references);
    if (candidates.length === 0) {
      return ZERO_BYTES;
    }

    const created = await this.prisma.$queryRaw<SizedBlob[]>`
      INSERT INTO "FileBlob" ("id", "projectId", "hash", "size")
      SELECT candidate."id", ${projectId}, candidate."hash", candidate."size"
      FROM unnest(
        ${candidates.map(() => this.idService.generate())}::text[],
        ${candidates.map((candidate) => candidate.hash)}::text[],
        ${candidates.map((candidate) => candidate.size)}::bigint[]
      ) AS candidate("id", "hash", "size")
      ON CONFLICT ("projectId", "hash") DO NOTHING
      RETURNING "size"
    `;

    return sumSizes(created);
  }

  private async resolveProjectBlobs(
    projectId: string,
    references: RowFileReference[],
  ): Promise<ResolvedReference[]> {
    if (references.length === 0) {
      return [];
    }

    const hashes = [...new Set(references.map((reference) => reference.hash))];
    const blobs = await this.prisma.$queryRaw<StoredBlob[]>`
      SELECT "id", "hash", "size"
      FROM "FileBlob"
      WHERE "projectId" = ${projectId} AND "hash" = ANY(${hashes}::text[])
    `;
    const blobByHash = new Map(blobs.map((blob) => [blob.hash, blob]));

    return references.flatMap((reference) => {
      const blob = blobByHash.get(reference.hash);
      if (!blob) {
        this.logger.warn(
          `FileBlob for projectId=${projectId} hash=${reference.hash} disappeared between insert and lookup`,
        );
        return [];
      }

      return [{ reference, blob }];
    });
  }

  private warnOnSizeMismatches(
    projectId: string,
    resolved: ResolvedReference[],
  ): void {
    for (const { reference, blob } of resolved) {
      if (blob.size !== reference.size) {
        this.logger.warn(
          `FileBlob size mismatch for projectId=${projectId} hash=${reference.hash}: existing=${blob.size} incoming=${reference.size}`,
        );
      }
    }
  }

  private async reactivateTombstonedBlobs(
    resolved: ResolvedReference[],
  ): Promise<bigint> {
    if (resolved.length === 0) {
      return ZERO_BYTES;
    }

    const blobIds = resolved.map(({ blob }) => blob.id);
    const reactivated = await this.prisma.$queryRaw<SizedBlob[]>`
      UPDATE "FileBlob"
      SET "deletedAt" = NULL
      WHERE "id" = ANY(${blobIds}::text[]) AND "deletedAt" IS NOT NULL
      RETURNING "size"
    `;

    return sumSizes(reactivated);
  }

  private async incrementProjectCounter(
    projectId: string,
    delta: bigint,
  ): Promise<void> {
    if (delta === ZERO_BYTES) {
      return;
    }

    await this.prisma.projectFileUsage.upsert({
      where: { projectId },
      create: { projectId, fileBytes: delta },
      update: { fileBytes: { increment: delta } },
    });
  }

  private async connectRowBlobLinks(
    resolved: ResolvedReference[],
  ): Promise<void> {
    if (resolved.length === 0) {
      return;
    }

    await this.prisma.$executeRaw`
      INSERT INTO "_FileBlobToRow" ("A", "B")
      SELECT * FROM unnest(
        ${resolved.map(({ blob }) => blob.id)}::text[],
        ${resolved.map(({ reference }) => reference.rowVersionId)}::text[]
      )
      ON CONFLICT DO NOTHING
    `;
  }

  private async cleanupDisconnectedBlobs(
    projectId: string,
    staleLinks: LinkedBlob[],
  ): Promise<void> {
    if (staleLinks.length === 0) {
      return;
    }

    await this.commandBus.execute(
      new CleanupFileBlobsByIdsCommand({
        projectId,
        blobIds: [...new Set(staleLinks.map((link) => link.id))],
      }),
    );
  }

  private get prisma() {
    return this.transactionPrisma.getTransactionUnsafe() ?? this.prismaService;
  }
}

interface RowFileReference {
  rowVersionId: string;
  hash: string;
  size: bigint;
}

interface SizedBlob {
  size: bigint;
}

interface StoredBlob extends SizedBlob {
  id: string;
  hash: string;
}

interface LinkedBlob extends StoredBlob {
  rowVersionId: string;
}

interface ResolvedReference {
  reference: RowFileReference;
  blob: StoredBlob;
}

interface RowBlobLinksPlan {
  staleLinks: LinkedBlob[];
  linkedReferences: ResolvedReference[];
  unlinkedReferences: RowFileReference[];
}

function planRowBlobLinks(
  references: RowFileReference[],
  linkedBlobs: LinkedBlob[],
): RowBlobLinksPlan {
  const linkByKey = new Map(
    linkedBlobs.map((link) => [rowHashKey(link), link]),
  );
  const referencedKeys = new Set(references.map(rowHashKey));
  const plan: RowBlobLinksPlan = {
    staleLinks: linkedBlobs.filter(
      (link) => !referencedKeys.has(rowHashKey(link)),
    ),
    linkedReferences: [],
    unlinkedReferences: [],
  };

  for (const reference of references) {
    const link = linkByKey.get(rowHashKey(reference));
    if (link) {
      plan.linkedReferences.push({ reference, blob: link });
    } else {
      plan.unlinkedReferences.push(reference);
    }
  }

  return plan;
}

function rowHashKey(entry: { rowVersionId: string; hash: string }): string {
  return `${entry.rowVersionId}:${entry.hash}`;
}

function firstReferencePerHash(
  references: RowFileReference[],
): RowFileReference[] {
  const byHash = new Map<string, RowFileReference>();
  for (const reference of references) {
    if (!byHash.has(reference.hash)) {
      byHash.set(reference.hash, reference);
    }
  }

  return [...byHash.values()];
}

function sumSizes(blobs: SizedBlob[]): bigint {
  return blobs.reduce((total, blob) => total + blob.size, ZERO_BYTES);
}
