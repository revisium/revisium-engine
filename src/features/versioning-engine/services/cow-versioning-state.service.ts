import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from 'src/__generated__/client';
import { ShareTransactionalQueries } from 'src/features/share/share.transactional.queries';
import { TransactionPrismaClient } from 'src/features/share/types';
import { IdService } from 'src/infrastructure/database/id.service';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

const CHUNK_SIZE = 512;

type Tx = TransactionPrismaClient;
type CowRevisionTableStateRef = {
  tableCreatedId: string;
  tableStateId: string;
};
type CurrentTableRef = {
  versionId: string;
  createdId: string;
};
type MaterializedRow = {
  versionId: string;
  createdId: string;
  id: string;
  readonly: boolean;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
  data: Prisma.JsonValue;
  meta: Prisma.JsonValue;
  hash: string | null;
  schemaHash: string | null;
};

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
      const tx: Tx = this.transactionService.getTransaction();
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
      const tx: Tx = this.transactionService.getTransaction();
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
      let draftState = await this.prisma.cowDraftState.findUnique({
        where: {
          branchId_tableCreatedId: {
            branchId: revision.branchId,
            tableCreatedId: table.createdId,
          },
        },
        select: { tableStateId: true, status: true },
      });

      if (!draftState) {
        await this.syncDraftStateFromCurrent(revision.branchId);
        draftState = await this.prisma.cowDraftState.findUnique({
          where: {
            branchId_tableCreatedId: {
              branchId: revision.branchId,
              tableCreatedId: table.createdId,
            },
          },
          select: { tableStateId: true, status: true },
        });
      }

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
      const tx: Tx = this.transactionService.getTransaction();
      await this.ensureRevisionSnapshotInTx(tx, sourceRevisionId);

      const sourceStates = await tx.cowRevisionTableState.findMany({
        where: { revisionId: sourceRevisionId },
        select: { tableCreatedId: true, tableStateId: true },
      });

      if (sourceStates.length === 0) {
        return;
      }

      await tx.cowRevisionTableState.createMany({
        data: this.mapRevisionTableStates(sourceStates, headRevisionId),
      });

      await tx.cowDraftState.createMany({
        data: this.mapDraftStates(sourceStates, branchId),
      });
    });
  }

  async snapshotCommittedRevisionFromCurrent(
    revisionId: string,
  ): Promise<void> {
    await this.transactionService.runSerializable(async () => {
      const tx: Tx = this.transactionService.getTransaction();
      const previousStateIds = await this.findRevisionTableStateIds(
        tx,
        revisionId,
      );
      await tx.cowRevisionTableState.deleteMany({ where: { revisionId } });
      await this.deleteOrphanedTableStates(tx, previousStateIds);
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
    const { tables } = await tx.revision.findUniqueOrThrow({
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

    await this.materializeCurrentTables(
      tx,
      tables,
      async (table, tableStateId) => {
        await tx.cowRevisionTableState.create({
          data: {
            revisionId,
            tableCreatedId: table.createdId,
            tableStateId,
          },
        });
      },
    );
  }

  private async syncDraftStateFromCurrentTx(
    tx: Tx,
    branchId: string,
  ): Promise<void> {
    const draftRevision = await tx.revision.findFirstOrThrow({
      where: { branchId, isDraft: true },
      select: { id: true },
    });

    const { tables } = await tx.revision.findUniqueOrThrow({
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

    const previousStateIds = await this.findDraftTableStateIds(tx, branchId);
    await tx.cowDraftState.deleteMany({ where: { branchId } });
    await this.deleteOrphanedTableStates(tx, previousStateIds);

    await this.materializeCurrentTables(
      tx,
      tables,
      async (table, tableStateId) => {
        await tx.cowDraftState.create({
          data: {
            branchId,
            tableCreatedId: table.createdId,
            tableStateId,
            status: 'active',
          },
        });
      },
    );
  }

  private mapRevisionTableStates(
    sourceStates: CowRevisionTableStateRef[],
    revisionId: string,
  ) {
    return sourceStates.map((state) => ({
      revisionId,
      tableCreatedId: state.tableCreatedId,
      tableStateId: state.tableStateId,
    }));
  }

  private mapDraftStates(
    sourceStates: CowRevisionTableStateRef[],
    branchId: string,
  ) {
    return sourceStates.map((state) => ({
      branchId,
      tableCreatedId: state.tableCreatedId,
      tableStateId: state.tableStateId,
      status: 'active' as const,
    }));
  }

  private async materializeCurrentTables(
    tx: Tx,
    tables: CurrentTableRef[],
    persistTableState: (
      table: CurrentTableRef,
      tableStateId: string,
    ) => Promise<void>,
  ): Promise<void> {
    for (const table of tables) {
      const tableStateId = await this.createTableStateFromCurrentTable(
        tx,
        table.versionId,
        table.createdId,
      );

      await persistTableState(table, tableStateId);
    }
  }

  private async findRevisionTableStateIds(
    tx: Tx,
    revisionId: string,
  ): Promise<string[]> {
    const states = await tx.cowRevisionTableState.findMany({
      where: { revisionId },
      select: { tableStateId: true },
    });

    return states.map((state: { tableStateId: string }) => state.tableStateId);
  }

  private async findDraftTableStateIds(
    tx: Tx,
    branchId: string,
  ): Promise<string[]> {
    const states = await tx.cowDraftState.findMany({
      where: { branchId },
      select: { tableStateId: true },
    });

    return states.map((state: { tableStateId: string }) => state.tableStateId);
  }

  private async deleteOrphanedTableStates(
    tx: Tx,
    tableStateIds: string[],
  ): Promise<void> {
    if (tableStateIds.length === 0) {
      return;
    }

    const orphanedStates = await tx.cowTableState.findMany({
      where: {
        id: { in: tableStateIds },
        revisionStates: { none: {} },
        draftStates: { none: {} },
      },
      select: { id: true },
    });
    const orphanedStateIds = orphanedStates.map(
      (state: { id: string }) => state.id,
    );

    if (orphanedStateIds.length === 0) {
      return;
    }

    const tableStateChunks = await tx.cowTableStateChunk.findMany({
      where: { tableStateId: { in: orphanedStateIds } },
      select: { chunkId: true },
    });
    const chunkIds = [
      ...new Set(
        tableStateChunks.map((chunk: { chunkId: string }) => chunk.chunkId),
      ),
    ];

    await tx.cowTableState.deleteMany({
      where: { id: { in: orphanedStateIds } },
    });

    if (chunkIds.length === 0) {
      return;
    }

    const orphanedChunks = await tx.cowTableChunk.findMany({
      where: {
        id: { in: chunkIds },
        tableStates: { none: {} },
      },
      select: { id: true },
    });
    const orphanedChunkIds = orphanedChunks.map(
      (chunk: { id: string }) => chunk.id,
    );

    if (orphanedChunkIds.length === 0) {
      return;
    }

    const rowStates = await tx.cowChunkEntry.findMany({
      where: { chunkId: { in: orphanedChunkIds } },
      select: { rowStateId: true },
    });
    const rowStateIds = [
      ...new Set(
        rowStates.map((entry: { rowStateId: string }) => entry.rowStateId),
      ),
    ];

    await tx.cowTableChunk.deleteMany({
      where: { id: { in: orphanedChunkIds } },
    });

    if (rowStateIds.length === 0) {
      return;
    }

    await tx.cowRowState.deleteMany({
      where: {
        id: { in: rowStateIds },
        chunkEntries: { none: {} },
      },
    });
  }

  private async createTableStateFromCurrentTable(
    tx: Tx,
    tableVersionId: string,
    tableCreatedId: string,
  ): Promise<string> {
    const tableStateId = this.idService.generate();
    await tx.cowTableState.create({
      data: {
        id: tableStateId,
        tableCreatedId,
        chunkCount: 0,
      },
    });

    let chunkCount = 0;
    let cursor:
      | {
          createdId: string;
          versionId: string;
        }
      | undefined;

    while (true) {
      const chunkRows = await tx.row.findMany({
        where: {
          tables: { some: { versionId: tableVersionId } },
          ...(cursor
            ? {
                OR: [
                  { createdId: { gt: cursor.createdId } },
                  {
                    AND: [
                      { createdId: cursor.createdId },
                      { versionId: { gt: cursor.versionId } },
                    ],
                  },
                ],
              }
            : {}),
        },
        orderBy: [{ createdId: 'asc' }, { versionId: 'asc' }],
        take: CHUNK_SIZE,
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

      if (chunkRows.length === 0) {
        break;
      }

      const chunkId = this.idService.generate();

      await tx.cowTableChunk.create({ data: { id: chunkId } });
      await tx.cowTableStateChunk.create({
        data: {
          tableStateId,
          chunkId,
          chunkNo: chunkCount,
        },
      });

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

      chunkCount += 1;
      const lastRow = chunkRows[chunkRows.length - 1] as MaterializedRow;
      cursor = {
        createdId: lastRow.createdId,
        versionId: lastRow.versionId,
      };
    }

    if (chunkCount > 0) {
      await tx.cowTableState.update({
        where: { id: tableStateId },
        data: { chunkCount },
      });
    }

    return tableStateId;
  }
}
