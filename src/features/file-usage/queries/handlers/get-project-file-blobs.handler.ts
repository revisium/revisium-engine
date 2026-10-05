import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { GetProjectFileBlobsQuery } from 'src/features/file-usage/queries/impl/get-project-file-blobs.query';
import type { GetProjectFileBlobsResult } from 'src/features/file-usage/queries/impl/get-project-file-blobs.query';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@QueryHandler(GetProjectFileBlobsQuery)
export class GetProjectFileBlobsHandler implements IQueryHandler<
  GetProjectFileBlobsQuery,
  GetProjectFileBlobsResult
> {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly transactionPrisma: TransactionPrismaService,
  ) {}

  async execute(
    query: GetProjectFileBlobsQuery,
  ): Promise<GetProjectFileBlobsResult> {
    return this.handle(query.data);
  }

  private async handle(
    data: GetProjectFileBlobsQuery['data'],
  ): Promise<GetProjectFileBlobsResult> {
    if (data.hashes.length === 0) {
      return [];
    }
    return this.prisma.fileBlob.findMany({
      where: {
        projectId: data.projectId,
        hash: { in: [...new Set(data.hashes)] },
      },
      select: { id: true, hash: true, size: true, deletedAt: true },
    });
  }

  private get prisma() {
    return this.transactionPrisma.getTransactionUnsafe() ?? this.prismaService;
  }
}
