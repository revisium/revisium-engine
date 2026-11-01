import { BadRequestException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { AbortMigrationCommand } from 'src/features/migration/commands/impl/abort-migration.command';
import { MigrationTransitionService } from 'src/features/migration/services/migration-transition.service';
import { MigrationStatus } from 'src/features/migration/types/migration.types';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@CommandHandler(AbortMigrationCommand)
export class AbortMigrationHandler implements ICommandHandler<
  AbortMigrationCommand,
  void
> {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly transitions: MigrationTransitionService,
  ) {}

  async execute({ data }: AbortMigrationCommand): Promise<void> {
    await this.transactionService.runSerializable(() => this.abort(data));
  }

  private async abort(data: AbortMigrationCommand['data']): Promise<void> {
    const transaction = this.transactionService.getTransaction();
    const migration = await this.transitions.findByTable(data, transaction);

    if (!migration) {
      return;
    }

    rejectUnabortable(migration.status);
    await this.transitions.cancel(migration, transaction);
  }
}

function rejectUnabortable(status: string): void {
  if (status === MigrationStatus.SWAPPING) {
    throw new BadRequestException(
      'Cannot abort during swap phase, please wait for completion',
    );
  }

  if (
    status === MigrationStatus.COMPLETED ||
    status === MigrationStatus.CANCELLED
  ) {
    throw new BadRequestException(`Migration already ${status.toLowerCase()}`);
  }
}
