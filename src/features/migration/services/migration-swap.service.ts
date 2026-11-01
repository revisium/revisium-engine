import { Injectable, Logger } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import type { TableMigration } from 'src/engine-prisma-types';
import { MigrateTableViewsCommand } from 'src/features/draft/commands/impl/transactional/migrate-table-views.command';
import { UpdateSchemaCommand } from 'src/features/draft/commands/impl/transactional/update-schema.command';
import { PermanentMigrationFailure } from 'src/features/migration/exceptions/permanent-migration-failure';
import {
  MigrationTransitionService,
  type MigrationLease,
} from 'src/features/migration/services/migration-transition.service';
import {
  SwapRecheckService,
  type VerifiedSwap,
} from 'src/features/migration/services/swap-recheck.service';
import type { MigrationStepResult } from 'src/features/migration/types/migration.types';
import { ShareCommands } from 'src/features/share/share.commands';
import { BranchWriteFenceService } from 'src/infrastructure/database/branch-write-fence.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@Injectable()
export class MigrationSwapService {
  private readonly logger = new Logger(MigrationSwapService.name);

  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly branchWriteFence: BranchWriteFenceService,
    private readonly transitions: MigrationTransitionService,
    private readonly rechecks: SwapRecheckService,
    private readonly commandBus: CommandBus,
    private readonly shareCommands: ShareCommands,
  ) {}

  private get transaction() {
    return this.transactionService.getTransaction();
  }

  async swap(
    lease: MigrationLease,
    migration: TableMigration,
  ): Promise<MigrationStepResult> {
    const swapped = await this.transactionService.runSerializable(() =>
      this.swapWithinTransaction(lease, migration),
    );

    if (!swapped) {
      return 'stopped';
    }

    this.logger.log(`Migration ${lease.migrationId} completed successfully`);
    await this.notifyDraftEndpoints(migration.revisionId);

    return 'completed';
  }

  private async swapWithinTransaction(
    lease: MigrationLease,
    migration: TableMigration,
  ): Promise<boolean> {
    await this.branchWriteFence.enterSharedForRevision(migration.revisionId);

    if (!(await this.transitions.lockSwap(lease, this.transaction))) {
      return false;
    }

    const swap = await this.rechecks.recheck(migration);
    await this.linkShadowTable(migration, swap);
    await this.recordSchemaUpdate(migration, swap);
    await this.migrateViews(migration, swap);
    await this.deleteSwappedRecord(lease);

    return true;
  }

  private async linkShadowTable(
    migration: TableMigration,
    swap: VerifiedSwap,
  ): Promise<void> {
    await this.transaction.revision.update({
      where: { id: migration.revisionId },
      data: {
        hasChanges: true,
        tables: {
          disconnect: { versionId: migration.sourceTableVersionId },
          connect: { versionId: swap.shadowTableVersionId },
        },
      },
    });
  }

  private async recordSchemaUpdate(
    migration: TableMigration,
    swap: VerifiedSwap,
  ): Promise<void> {
    const recorded = await this.commandBus.execute<
      UpdateSchemaCommand,
      boolean
    >(
      new UpdateSchemaCommand({
        revisionId: migration.revisionId,
        tableId: migration.tableId,
        schema: swap.targetSchema,
        patches: swap.patches,
        migrationId: swap.ledgerMigrationId,
      }),
    );

    if (!recorded && swap.ledgerMigrationId !== undefined) {
      throw new PermanentMigrationFailure(
        'LEDGER_NOT_RECORDED',
        `the Draft recorded no ledger row ${swap.ledgerMigrationId}`,
      );
    }
  }

  private migrateViews(
    migration: TableMigration,
    swap: VerifiedSwap,
  ): Promise<void> {
    return this.commandBus.execute<MigrateTableViewsCommand, void>(
      new MigrateTableViewsCommand({
        revisionId: migration.revisionId,
        tableId: migration.tableId,
        patches: swap.patches,
        previousSchema: swap.previousSchema,
      }),
    );
  }

  private async deleteSwappedRecord(lease: MigrationLease): Promise<void> {
    if (!(await this.transitions.completeSwap(lease, this.transaction))) {
      throw new Error(
        `Migration ${lease.migrationId} lost its record inside its own swap`,
      );
    }
  }

  private async notifyDraftEndpoints(revisionId: string): Promise<void> {
    try {
      await this.shareCommands.notifyEndpoints({ revisionId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Endpoints of revision ${revisionId} were not notified after a swap: ${message}`,
      );
    }
  }
}
