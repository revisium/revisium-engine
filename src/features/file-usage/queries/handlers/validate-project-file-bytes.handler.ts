import { Injectable } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { ValidateProjectFileBytesQuery } from 'src/features/file-usage/queries/impl/validate-project-file-bytes.query';
import { ValidateProjectFileBytesResult } from 'src/features/file-usage/types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

const ZERO_BYTES: bigint = BigInt(0);

@Injectable()
@QueryHandler(ValidateProjectFileBytesQuery)
export class ValidateProjectFileBytesHandler implements IQueryHandler<
  ValidateProjectFileBytesQuery,
  ValidateProjectFileBytesResult
> {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly transactionPrisma: TransactionPrismaService,
  ) {}

  async execute({
    data,
  }: ValidateProjectFileBytesQuery): Promise<ValidateProjectFileBytesResult> {
    const projectId = data.projectId;
    const currentFileBytes = await this.readCurrentFileBytes(projectId);
    const { expectedFileBytes, fileBlobCount } =
      await this.aggregateExpectedFileBytes(projectId);
    const referenceCount = await this.countReferences(projectId);

    return {
      projectId,
      currentFileBytes,
      expectedFileBytes,
      drift: expectedFileBytes - currentFileBytes,
      fileBlobCount,
      referenceCount,
    };
  }

  private async readCurrentFileBytes(projectId: string): Promise<bigint> {
    const usage = await this.prisma.projectFileUsage.findUnique({
      where: { projectId },
      select: { fileBytes: true },
    });
    return usage?.fileBytes ?? ZERO_BYTES;
  }

  private async aggregateExpectedFileBytes(
    projectId: string,
  ): Promise<{ expectedFileBytes: bigint; fileBlobCount: number }> {
    const aggregate = await this.prisma.fileBlob.aggregate({
      where: { projectId, deletedAt: null },
      _sum: { size: true },
      _count: { _all: true },
    });

    return {
      expectedFileBytes: aggregate._sum.size ?? ZERO_BYTES,
      fileBlobCount: aggregate._count._all,
    };
  }

  private async countReferences(projectId: string): Promise<number> {
    const blobs = await this.prisma.fileBlob.findMany({
      where: { projectId, deletedAt: null },
      select: { _count: { select: { rows: true } } },
    });

    return blobs.reduce((total, blob) => total + blob._count.rows, 0);
  }

  private get prisma() {
    return this.transactionPrisma.getTransactionUnsafe() ?? this.prismaService;
  }
}
