import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from 'src/__generated__/client';
import { ShareTransactionalQueries } from 'src/features/share/share.transactional.queries';
import { TransactionPrismaClient } from 'src/features/share/types';
import { IdService } from 'src/infrastructure/database/id.service';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

const CHUNK_SIZE = 512;

type Tx = TransactionPrismaClient;

@Injectable()
export class CowVersioningStateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionService: TransactionPrismaService,
    private readonly shareQueries: ShareTransactionalQueries,
    private readonly idService: IdService,
  ) {}

  async ensureRevisionSnapshot(revisionId: string): Promise<void> {
    await this.transactionService.runSerializable(async () => {
      const tx = this.transactionService.getTransaction() as Tx;
      const revision = await tx.revision.findUniqueOrThrow({
        where: { id: revisionId },
        select: { id: true, isDraft: true, branchId: true },
      });

      if (revision.isDraft) {
        await this.syncDraftStateFromCurrentTx(tx, revision.branchId);
        return;
      }

      const existing = await tx.cowRevisionTableState.count({
        where: { revisionId },
      });
      if (existing > 0) {
        return;
      }

      await this.buildRevisionSnapshotFromCurrent(tx, revisionId);
    });
  }

  async syncDraftStateFromCurrent(branchId: string): Promise<void> {
    await this.transactionService.runSerializable(async () => {
      const tx = this.transactionService.getTransaction() as Tx;
      await this.syncDraftStateFromCurrentTx(tx, branchId);
    });
  }

  async resolveTableStateId(
    revisionId: string,
    tableId: string,
  ): Promise<string> {
    const revision = await this.prisma.revision.findUniqueOrThrow({
      where: { id: revisionId },
      select: { id: true, isDraft: true, branchId: true },
    });
    const table = await this.shareQueries.findTableInRevisionOrThrow(
      revisionId,
      tableId,
    );

    if (revision.isDraft) {
      await this.syncDraftStateFromCurrent(revision.branchId);
      const draftState = await this.prisma.cowDraftState.findUnique({
        where: {
          branchId_tableCreatedId: {
            branchId: revision.branchId,
            tableCreatedId: table.createdId,
          },
        },
        select: { tableStateId: true, status: true },
      });

      if (!draftState || draftState.status === 'deleted') {
        throw new NotFoundException(
          `Table ${tableId} not found in draft state`,
        );
      }

      return draftState.tableStateId;
    }

    await this.ensureRevisionSnapshot(revisionId);
    const revisionState = await this.prisma.cowRevisionTableState.findUnique({
      where: {
        revisionId_tableCreatedId: {
          revisionId,
          tableCreatedId: table.createdId,
        },
      },
      select: { tableStateId: true },
    });

    if (!revisionState) {
      throw new NotFoundException(
        `Table ${tableId} not found in revision state`,
      );
    }

    return revisionState.tableStateId;
  }

  async seedBranchFromRevision(
    sourceRevisionId: string,
    branchId: string,
    headRevisionId: string,
  ): Promise<void> {
    await this.transactionService.runSerializable(async () => {
      const tx = this.transactionService.getTransaction() as Tx;
      await this.ensureRevisionSnapshotInTx(tx, sourceRevisionId);

      const sourceStates = await tx.cowRevisionTableState.findMany({
        where: { revisionId: sourceRevisionId },
        select: { tableCreatedId: true, tableStateId: true },
      });

      if (sourceStates.length === 0) {
        return;
      }

      await tx.cowRevisionTableState.createMany({
        data: sourceStates.map((state) => ({
          revisionId: headRevisionId,
          tableCreatedId: state.tableCreatedId,
          tableStateId: state.tableStateId,
        })),
      });

      await tx.cowDraftState.createMany({
        data: sourceStates.map((state) => ({
          branchId,
          tableCreatedId: state.tableCreatedId,
          tableStateId: state.tableStateId,
          status: 'active',
        })),
      });
    });
  }

  async snapshotCommittedRevisionFromCurrent(
    revisionId: string,
  ): Promise<void> {
    await this.transactionService.runSerializable(async () => {
      const tx = this.transactionService.getTransaction() as Tx;
      await tx.cowRevisionTableState.deleteMany({ where: { revisionId } });
      await this.buildRevisionSnapshotFromCurrent(tx, revisionId);
    });
  }

  private async ensureRevisionSnapshotInTx(
    tx: Tx,
    revisionId: string,
  ): Promise<void> {
    const existing = await tx.cowRevisionTableState.count({
      where: { revisionId },
    });
    if (existing > 0) {
      return;
    }
    await this.buildRevisionSnapshotFromCurrent(tx, revisionId);
  }

  private async buildRevisionSnapshotFromCurrent(
    tx: Tx,
    revisionId: string,
  ): Promise<void> {
    const revision = await tx.revision.findUniqueOrThrow({
      where: { id: revisionId },
      select: {
        tables: {
          select: {
            versionId: true,
            createdId: true,
          },
          orderBy: { createdId: 'asc' },
        },
      },
    });

    for (const table of revision.tables) {
      const tableStateId = await this.createTableStateFromCurrentTable(
        tx,
        table.versionId,
        table.createdId,
      );

      await tx.cowRevisionTableState.create({
        data: {
          revisionId,
          tableCreatedId: table.createdId,
          tableStateId,
        },
      });
    }
  }

  private async syncDraftStateFromCurrentTx(
    tx: Tx,
    branchId: string,
  ): Promise<void> {
    const draftRevision = await tx.revision.findFirstOrThrow({
      where: { branchId, isDraft: true },
      select: { id: true },
    });

    const draft = await tx.revision.findUniqueOrThrow({
      where: { id: draftRevision.id },
      select: {
        tables: {
          select: {
            versionId: true,
            createdId: true,
          },
          orderBy: { createdId: 'asc' },
        },
      },
    });

    await tx.cowDraftState.deleteMany({ where: { branchId } });

    for (const table of draft.tables) {
      const tableStateId = await this.createTableStateFromCurrentTable(
        tx,
        table.versionId,
        table.createdId,
      );

      await tx.cowDraftState.create({
        data: {
          branchId,
          tableCreatedId: table.createdId,
          tableStateId,
          status: 'active',
        },
      });
    }
  }

  private async createTableStateFromCurrentTable(
    tx: Tx,
    tableVersionId: string,
    tableCreatedId: string,
  ): Promise<string> {
    const rows = await tx.row.findMany({
      where: { tables: { some: { versionId: tableVersionId } } },
      orderBy: [{ createdId: 'asc' }, { versionId: 'asc' }],
      select: {
        versionId: true,
        createdId: true,
        id: true,
        readonly: true,
        createdAt: true,
        updatedAt: true,
        publishedAt: true,
        data: true,
        meta: true,
        hash: true,
        schemaHash: true,
      },
    });

    const tableStateId = this.idService.generate();
    const chunks = this.chunkRows(rows);

    await tx.cowTableState.create({
      data: {
        id: tableStateId,
        tableCreatedId,
        chunkCount: chunks.length,
      },
    });

    for (const [chunkNo, chunkRows] of chunks.entries()) {
      const chunkId = this.idService.generate();

      await tx.cowTableChunk.create({ data: { id: chunkId } });
      await tx.cowTableStateChunk.create({
        data: {
          tableStateId,
          chunkId,
          chunkNo,
        },
      });

      if (chunkRows.length === 0) {
        continue;
      }

      await tx.cowRowState.createMany({
        data: chunkRows.map((row) => ({
          id: row.versionId,
          rowCreatedId: row.createdId,
          rowId: row.id,
          readonly: row.readonly,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          publishedAt: row.publishedAt,
          data: row.data as Prisma.InputJsonValue,
          meta: row.meta as Prisma.InputJsonValue,
          hash: row.hash,
          schemaHash: row.schemaHash,
        })),
        skipDuplicates: true,
      });

      await tx.cowChunkEntry.createMany({
        data: chunkRows.map((row) => ({
          chunkId,
          rowCreatedId: row.createdId,
          rowStateId: row.versionId,
          isDeleted: false,
        })),
      });
    }

    return tableStateId;
  }

  private chunkRows<T>(rows: T[]): T[][] {
    if (rows.length === 0) {
      return [];
    }

    const chunks: T[][] = [];
    for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
      chunks.push(rows.slice(index, index + CHUNK_SIZE));
    }
    return chunks;
  }
}
