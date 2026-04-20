import { Injectable } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { GetProjectStorageBytesQuery } from 'src/features/file-usage/queries/impl/get-project-storage-bytes.query';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

const ZERO_BYTES: bigint = BigInt(0);

@Injectable()
@QueryHandler(GetProjectStorageBytesQuery)
export class GetProjectStorageBytesHandler implements IQueryHandler<
  GetProjectStorageBytesQuery,
  bigint
> {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly transactionPrisma: TransactionPrismaService,
  ) {}

  async execute({ data }: GetProjectStorageBytesQuery): Promise<bigint> {
    const usage = await this.prisma.projectFileUsage.findUnique({
      where: { projectId: data.projectId },
      select: { fileBytes: true },
    });

    return usage?.fileBytes ?? ZERO_BYTES;
  }

  private get prisma() {
    return this.transactionPrisma.getTransactionUnsafe() ?? this.prismaService;
  }
}
