import { Injectable } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { GetPendingStorageDeletionsQuery } from 'src/features/file-usage/queries/impl/get-pending-storage-deletions.query';
import { PendingStorageDeletion } from 'src/features/file-usage/types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

const DEFAULT_PAGE_SIZE = 1000;

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

    const tombstoned = await this.prisma.fileBlob.findMany({
      where: {
        deletedAt: { not: null },
        ...(data.afterHash ? { hash: { gt: data.afterHash } } : {}),
      },
      select: { hash: true, size: true },
      distinct: ['hash'],
      orderBy: { hash: 'asc' },
    });

    if (tombstoned.length === 0) {
      return [];
    }

    const active = await this.prisma.fileBlob.findMany({
      where: {
        deletedAt: null,
        hash: { in: tombstoned.map((row) => row.hash) },
      },
      select: { hash: true },
      distinct: ['hash'],
    });
    const activeSet = new Set(active.map((row) => row.hash));

    const pending: PendingStorageDeletion[] = [];
    for (const row of tombstoned) {
      if (pending.length >= limit) {
        break;
      }
      if (activeSet.has(row.hash)) {
        continue;
      }
      pending.push({ hash: row.hash, size: row.size });
    }
    return pending;
  }

  private get prisma() {
    return this.transactionPrisma.getTransactionUnsafe() ?? this.prismaService;
  }
}
