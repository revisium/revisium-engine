import { Injectable } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { ConfirmStorageDeletedCommand } from 'src/features/file-usage/commands/impl/confirm-storage-deleted.command';
import { ConfirmStorageDeletedResult } from 'src/features/file-usage/types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@Injectable()
@CommandHandler(ConfirmStorageDeletedCommand)
export class ConfirmStorageDeletedHandler implements ICommandHandler<
  ConfirmStorageDeletedCommand,
  ConfirmStorageDeletedResult
> {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly transactionPrisma: TransactionPrismaService,
  ) {}

  async execute({
    data,
  }: ConfirmStorageDeletedCommand): Promise<ConfirmStorageDeletedResult> {
    if (data.hashes.length === 0) {
      return { hashesConfirmed: 0, blobsDeleted: 0 };
    }

    const deleted = await this.deleteTombstonedBlobs(data.hashes);

    return {
      hashesConfirmed: data.hashes.length,
      blobsDeleted: deleted,
    };
  }

  private async deleteTombstonedBlobs(
    hashes: readonly string[],
  ): Promise<number> {
    const result = await this.prisma.fileBlob.deleteMany({
      where: {
        hash: { in: [...hashes] },
        deletedAt: { not: null },
      },
    });
    return result.count;
  }

  private get prisma() {
    return this.transactionPrisma.getTransactionUnsafe() ?? this.prismaService;
  }
}
