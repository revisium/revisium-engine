import { BadRequestException, Logger } from '@nestjs/common';
import { CommandBus, CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import { CheckImportedMigrationIdCommand } from 'src/features/draft/commands/impl/migration';
import {
  ValidateTableUpdateCommand,
  ValidateTableUpdateCommandReturnType,
} from 'src/features/draft/commands/impl/transactional/validate-table-update.command';
import { StartAsyncMigrationCommand } from 'src/features/migration/commands/impl/start-async-migration.command';
import { LedgerUnavailableException } from 'src/features/migration/exceptions/ledger-unavailable.exception';
import { MigrationLockService } from 'src/features/migration/services/migration-lock.service';
import { MigrationService } from 'src/features/migration/services/migration.service';
import { MigrationWorkerService } from 'src/features/migration/services/migration-worker.service';
import { StartAsyncMigrationResult } from 'src/features/migration/types/migration.types';
import { BranchWriteFenceService } from 'src/infrastructure/database/branch-write-fence.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import { ShareTransactionalQueries } from 'src/features/share/share.transactional.queries';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { InputJsonValue } from 'src/engine-prisma-types';

type StartAsyncMigrationData = StartAsyncMigrationCommand['data'];

@CommandHandler(StartAsyncMigrationCommand)
export class StartAsyncMigrationHandler implements ICommandHandler<
  StartAsyncMigrationCommand,
  StartAsyncMigrationResult
> {
  private readonly logger = new Logger(StartAsyncMigrationHandler.name);

  constructor(
    private readonly migrationService: MigrationService,
    private readonly workerService: MigrationWorkerService,
    private readonly migrationLockService: MigrationLockService,
    private readonly transactionService: TransactionPrismaService,
    private readonly branchWriteFence: BranchWriteFenceService,
    private readonly commandBus: CommandBus,
    private readonly jsonSchemaValidator: JsonSchemaValidatorService,
    private readonly shareTransactionalQueries: ShareTransactionalQueries,
  ) {}

  private get transaction() {
    return this.transactionService.getTransaction();
  }

  async execute({
    data,
  }: StartAsyncMigrationCommand): Promise<StartAsyncMigrationResult> {
    const migrationId = await this.transactionService.runSerializable(() =>
      this.startMigration(data),
    );

    await this.triggerWorker(migrationId);

    return { migrationId, status: 'migrating' };
  }

  private async startMigration(data: StartAsyncMigrationData): Promise<string> {
    await this.branchWriteFence.enterSharedForRevision(data.revisionId);
    await this.ensureRevisionIsDraft(data.revisionId);
    await this.migrationLockService.checkRevisionLock(data.revisionId);

    const { targetSchema } = await this.validateTableUpdate(data);

    if (data.ledgerMigrationId !== undefined) {
      await this.ensureLedgerAvailable(data.revisionId);
      await this.checkImportedMigrationId(
        data.revisionId,
        data.ledgerMigrationId,
      );
    }

    return this.recordMigration(data, targetSchema);
  }

  private async ensureRevisionIsDraft(revisionId: string): Promise<void> {
    const revision = await this.transaction.revision.findUniqueOrThrow({
      where: { id: revisionId },
    });

    if (!revision.isDraft) {
      throw new BadRequestException('Revision is not a draft');
    }
  }

  private validateTableUpdate({
    revisionId,
    tableId,
    patches,
  }: StartAsyncMigrationData): Promise<ValidateTableUpdateCommandReturnType> {
    return this.commandBus.execute<
      ValidateTableUpdateCommand,
      ValidateTableUpdateCommandReturnType
    >(new ValidateTableUpdateCommand({ revisionId, tableId, patches }));
  }

  private async ensureLedgerAvailable(revisionId: string): Promise<void> {
    const migrationTable = await this.transaction.table.findFirst({
      where: {
        id: SystemTables.Migration,
        revisions: { some: { id: revisionId } },
      },
      select: { versionId: true },
    });

    if (!migrationTable) {
      throw new LedgerUnavailableException();
    }
  }

  private checkImportedMigrationId(
    revisionId: string,
    ledgerMigrationId: string,
  ): Promise<void> {
    return this.commandBus.execute<CheckImportedMigrationIdCommand, void>(
      new CheckImportedMigrationIdCommand(revisionId, ledgerMigrationId),
    );
  }

  private async recordMigration(
    data: StartAsyncMigrationData,
    targetSchema: JsonSchema,
  ): Promise<string> {
    const table =
      await this.shareTransactionalQueries.findTableInRevisionOrThrow(
        data.revisionId,
        data.tableId,
      );
    const { schema: previousSchema, hash: previousSchemaHash } =
      await this.shareTransactionalQueries.getTableSchema(
        data.revisionId,
        data.tableId,
      );

    return this.migrationService.createMigrationRecord({
      ...data,
      sourceTableVersionId: table.versionId,
      previousSchema: previousSchema as InputJsonValue,
      previousSchemaHash,
      targetSchemaHash: this.jsonSchemaValidator.getSchemaHash(targetSchema),
      totalRows: await this.migrationService.countRows(
        table.versionId,
        this.transaction,
      ),
    });
  }

  private async triggerWorker(migrationId: string): Promise<void> {
    try {
      await this.workerService.triggerInline(migrationId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Migration ${migrationId} was started, but triggering its worker failed: ${message}`,
      );
    }
  }
}
