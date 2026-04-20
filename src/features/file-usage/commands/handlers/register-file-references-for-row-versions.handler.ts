import { Injectable } from '@nestjs/common';
import { CommandBus, CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import type { InputJsonValue } from 'src/engine-prisma-types';
import { RegisterFileReferencesForRowVersionsCommand } from 'src/features/file-usage/commands/impl/register-file-references-for-row-versions.command';
import { RegisterFileReferencesForRowsCommand } from 'src/features/file-usage/commands/impl/register-file-references-for-rows.command';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

interface ResolvedRow {
  rowId: string;
  rowVersionId: string;
  data: InputJsonValue;
}

@Injectable()
@CommandHandler(RegisterFileReferencesForRowVersionsCommand)
export class RegisterFileReferencesForRowVersionsHandler implements ICommandHandler<
  RegisterFileReferencesForRowVersionsCommand,
  void
> {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly prismaService: PrismaService,
    private readonly transactionPrisma: TransactionPrismaService,
  ) {}

  async execute({
    data,
  }: RegisterFileReferencesForRowVersionsCommand): Promise<void> {
    if (data.rowVersionIds.length === 0) {
      return;
    }

    const rows = await this.loadRowsByVersionId(data.rowVersionIds);
    if (rows.length === 0) {
      return;
    }

    await this.commandBus.execute(
      new RegisterFileReferencesForRowsCommand({
        revisionId: data.revisionId,
        tableId: data.tableId,
        rows,
      }),
    );
  }

  private async loadRowsByVersionId(
    rowVersionIds: readonly string[],
  ): Promise<ResolvedRow[]> {
    const rows = await this.prisma.row.findMany({
      where: { versionId: { in: [...rowVersionIds] } },
      select: { versionId: true, id: true, data: true },
    });

    return rows.map((row) => ({
      rowId: row.id,
      rowVersionId: row.versionId,
      data: row.data as InputJsonValue,
    }));
  }

  private get prisma() {
    return this.transactionPrisma.getTransactionUnsafe() ?? this.prismaService;
  }
}
