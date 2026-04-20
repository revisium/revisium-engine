import { Injectable, Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler, QueryBus } from '@nestjs/cqrs';
import { RestoreProjectFileBytesCommand } from 'src/features/file-usage/commands/impl/restore-project-file-bytes.command';
import { ValidateProjectFileBytesQuery } from 'src/features/file-usage/queries/impl/validate-project-file-bytes.query';
import {
  RestoreProjectFileBytesResult,
  ValidateProjectFileBytesResult,
} from 'src/features/file-usage/types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

const ZERO_BYTES: bigint = BigInt(0);

@Injectable()
@CommandHandler(RestoreProjectFileBytesCommand)
export class RestoreProjectFileBytesHandler implements ICommandHandler<
  RestoreProjectFileBytesCommand,
  RestoreProjectFileBytesResult
> {
  private readonly logger = new Logger(RestoreProjectFileBytesHandler.name);

  constructor(
    private readonly queryBus: QueryBus,
    private readonly prismaService: PrismaService,
    private readonly transactionPrisma: TransactionPrismaService,
  ) {}

  async execute({
    data,
  }: RestoreProjectFileBytesCommand): Promise<RestoreProjectFileBytesResult> {
    const validation = await this.validate(data.projectId);

    if (validation.drift === ZERO_BYTES) {
      return this.unchangedResult(data.projectId, validation.currentFileBytes);
    }

    await this.setProjectFileBytes(
      data.projectId,
      validation.expectedFileBytes,
    );

    this.logDriftCorrection(data.projectId, validation);

    return this.restoredResult(data.projectId, validation);
  }

  private validate(projectId: string): Promise<ValidateProjectFileBytesResult> {
    return this.queryBus.execute(
      new ValidateProjectFileBytesQuery({ projectId }),
    );
  }

  private async setProjectFileBytes(
    projectId: string,
    value: bigint,
  ): Promise<void> {
    await this.prisma.projectFileUsage.upsert({
      where: { projectId },
      create: { projectId, fileBytes: value },
      update: { fileBytes: value },
    });
  }

  private logDriftCorrection(
    projectId: string,
    validation: ValidateProjectFileBytesResult,
  ): void {
    this.logger.log(
      `Restored ProjectFileUsage for ${projectId}: ${validation.currentFileBytes} -> ${validation.expectedFileBytes} (drift=${validation.drift})`,
    );
  }

  private unchangedResult(
    projectId: string,
    currentFileBytes: bigint,
  ): RestoreProjectFileBytesResult {
    return {
      projectId,
      previousFileBytes: currentFileBytes,
      nextFileBytes: currentFileBytes,
      drift: ZERO_BYTES,
    };
  }

  private restoredResult(
    projectId: string,
    validation: ValidateProjectFileBytesResult,
  ): RestoreProjectFileBytesResult {
    return {
      projectId,
      previousFileBytes: validation.currentFileBytes,
      nextFileBytes: validation.expectedFileBytes,
      drift: validation.drift,
    };
  }

  private get prisma() {
    return this.transactionPrisma.getTransactionUnsafe() ?? this.prismaService;
  }
}
