import { Injectable } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { GetPendingStorageDeletionsQuery } from 'src/features/file-usage/queries/impl/get-pending-storage-deletions.query';
import { PendingStorageDeletion } from 'src/features/file-usage/types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

const DEFAULT_PAGE_SIZE = 1000;
const BATCH_SIZE = 500;

@Injectable()
@QueryHandler(GetPendingStorageDeletionsQuery)
export class GetPendingStorageDeletionsHandler implements IQueryHandler<
  GetPendingStorageDeletionsQuery,
  PendingStorageDeletion[]
> {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly transactionPrisma: TransactionPrismaService,
  ) {}

  async execute({
    data,
  }: GetPendingStorageDeletionsQuery): Promise<PendingStorageDeletion[]> {
    const limit = data.limit ?? DEFAULT_PAGE_SIZE;
    if (limit <= 0) {
      return [];
    }

    const pending: PendingStorageDeletion[] = [];
    let cursor = data.afterHash ?? null;

    while (pending.length < limit) {
      const batch = await this.fetchTombstonedBatch(cursor);
      if (batch.length === 0) {
        break;
      }

      const activeSet = await this.findActiveHashes(
        batch.map((row) => row.hash),
      );

      for (const row of batch) {
        if (pending.length >= limit) {
          break;
        }
        if (activeSet.has(row.hash)) {
          continue;
        }
        pending.push({ hash: row.hash, size: row.size });
      }

      cursor = batch[batch.length - 1]?.hash ?? cursor;

      if (batch.length < BATCH_SIZE) {
        break;
      }
    }

    return pending;
  }

  private async fetchTombstonedBatch(
    afterHash: string | null,
  ): Promise<Array<{ hash: string; size: bigint }>> {
    return this.prisma.fileBlob.findMany({
      where: {
        deletedAt: { not: null },
        ...(afterHash ? { hash: { gt: afterHash } } : {}),
      },
      select: { hash: true, size: true },
      distinct: ['hash'],
      orderBy: { hash: 'asc' },
      take: BATCH_SIZE,
    });
  }

  private async findActiveHashes(
    hashes: readonly string[],
  ): Promise<Set<string>> {
    if (hashes.length === 0) {
      return new Set();
    }

    const active = await this.prisma.fileBlob.findMany({
      where: {
        deletedAt: null,
        hash: { in: [...hashes] },
      },
      select: { hash: true },
      distinct: ['hash'],
    });
    return new Set(active.map((row) => row.hash));
  }

  private get prisma() {
    return this.transactionPrisma.getTransactionUnsafe() ?? this.prismaService;
  }
}
