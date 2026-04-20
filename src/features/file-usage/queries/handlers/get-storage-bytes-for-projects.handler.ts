import { Injectable } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { GetStorageBytesForProjectsQuery } from 'src/features/file-usage/queries/impl/get-storage-bytes-for-projects.query';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

const ZERO_BYTES: bigint = BigInt(0);

@Injectable()
@QueryHandler(GetStorageBytesForProjectsQuery)
export class GetStorageBytesForProjectsHandler implements IQueryHandler<
  GetStorageBytesForProjectsQuery,
  bigint
> {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly transactionPrisma: TransactionPrismaService,
  ) {}

  async execute({ data }: GetStorageBytesForProjectsQuery): Promise<bigint> {
    if (data.projectIds.length === 0) {
      return ZERO_BYTES;
    }

    const aggregate = await this.prisma.projectFileUsage.aggregate({
      where: { projectId: { in: [...data.projectIds] } },
      _sum: { fileBytes: true },
    });

    return aggregate._sum.fileBytes ?? ZERO_BYTES;
  }

  private get prisma() {
    return this.transactionPrisma.getTransactionUnsafe() ?? this.prismaService;
  }
}
