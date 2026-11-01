import { BadRequestException, Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TransactionIsolationLevel } from 'src/engine-prisma-types';
import {
  ApplyMigrationCommandReturnType,
  ApplyMigrationResult,
  ApplyMigrationsCommand,
  MigrationAlreadyAppliedException,
} from 'src/features/draft/commands/impl/migration';
import { DraftApiService } from 'src/features/draft/draft-api.service';
import { DraftTransactionalCommands } from 'src/features/draft/draft.transactional.commands';
import { MigrationContextService } from 'src/features/draft/migration-context.service';
import {
  MigrationImportService,
  type EndedMigration,
} from 'src/features/migration/services/migration-import.service';
import { MigrationStatus } from 'src/features/migration/types/migration.types';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import { Migration, UpdateMigration } from '@revisium/schema-toolkit/types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@CommandHandler(ApplyMigrationsCommand)
export class ApplyMigrationsHandler implements ICommandHandler<
  ApplyMigrationsCommand,
  ApplyMigrationCommandReturnType
> {
  private readonly logger = new Logger(ApplyMigrationsHandler.name);

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly transactionService: TransactionPrismaService,
    protected readonly jsonSchemaValidator: JsonSchemaValidatorService,
    protected readonly draftApiService: DraftApiService,
    protected readonly draftTransactionalCommands: DraftTransactionalCommands,
    protected readonly migrationContextService: MigrationContextService,
    protected readonly migrationImport: MigrationImportService,
  ) {}

  async execute({ data }: ApplyMigrationsCommand) {
    await this.checkIsDraftRevision(data.revisionId);
    this.checkMigration(data.migrations);

    const response: ApplyMigrationResult[] = [];

    for (const migration of data.migrations) {
      const result: ApplyMigrationResult =
        await this.migrationContextService.run(migration.id, () =>
          this.applyMigration(data.revisionId, migration),
        );

      response.push(result);

      if (result.status === 'failed') {
        break;
      }
    }

    return response;
  }

  private checkMigration(migrations: Migration[]) {
    for (const migration of migrations) {
      const { result, errors } =
        this.jsonSchemaValidator.validateTableMigrationsSchema(migration);

      if (!result) {
        this.logger.error(errors);
        this.logger.error(migration);

        throw new BadRequestException('Invalid migration');
      }
    }
  }

  protected async checkIsDraftRevision(revisionId: string) {
    const revision = await this.prisma.revision.findUniqueOrThrow({
      where: {
        id: revisionId,
      },
    });

    if (!revision.isDraft) {
      throw new BadRequestException('Revision is not draft revision');
    }
  }

  private async applyMigration(
    revisionId: string,
    migration: Migration,
  ): Promise<ApplyMigrationResult> {
    try {
      await this.checkImportedId(revisionId);

      if (migration.changeType === 'update') {
        return await this.applyUpdate(revisionId, migration);
      }

      await this.changeTable(revisionId, migration);

      return appliedResult(migration.id);
    } catch (error) {
      return this.unappliedResult(migration.id, error);
    }
  }

  private async applyUpdate(
    revisionId: string,
    migration: UpdateMigration,
  ): Promise<ApplyMigrationResult> {
    const asyncMigrationId = await this.joinOrUpdateTable(
      revisionId,
      migration,
    );

    if (asyncMigrationId === undefined) {
      return appliedResult(migration.id);
    }

    const ended = await this.migrationImport.driveUntilEnded(asyncMigrationId);

    return this.asyncUpdateResult(revisionId, migration.id, ended);
  }

  private async joinOrUpdateTable(
    revisionId: string,
    migration: UpdateMigration,
  ): Promise<string | undefined> {
    const activeImport = await this.migrationImport.findActiveImport(
      revisionId,
      migration.id,
    );

    if (activeImport !== undefined) {
      return activeImport;
    }

    const { migrationId } = await this.draftApiService.apiUpdateTable({
      revisionId,
      tableId: migration.tableId,
      patches: migration.patches,
    });

    return migrationId;
  }

  private async asyncUpdateResult(
    revisionId: string,
    id: string,
    ended: EndedMigration | null,
  ): Promise<ApplyMigrationResult> {
    if (await this.isRecordedInDraftLedger(revisionId)) {
      return appliedResult(id);
    }

    return {
      id,
      status: 'failed',
      error: unrecordedFailureOf(ended),
    };
  }

  private async isRecordedInDraftLedger(revisionId: string): Promise<boolean> {
    try {
      await this.checkImportedId(revisionId);

      return false;
    } catch (error) {
      if (error instanceof MigrationAlreadyAppliedException) {
        return true;
      }

      throw error;
    }
  }

  private checkImportedId(revisionId: string) {
    // Table changes, the async start among them, repeat this check in their
    // transaction. RepeatableRead gives both lookups one snapshot.
    return this.transactionService.run(
      () =>
        this.draftTransactionalCommands.checkImportedMigrationId(revisionId),
      { isolationLevel: TransactionIsolationLevel.RepeatableRead },
    );
  }

  private unappliedResult(id: string, error: unknown): ApplyMigrationResult {
    if (error instanceof MigrationAlreadyAppliedException) {
      return {
        id,
        status: 'skipped',
      };
    }

    this.logger.error(error);

    return {
      id,
      status: 'failed',
      error: (error as Error).message,
    };
  }

  private async changeTable(revisionId: string, migration: Migration) {
    if (migration.changeType === 'init') {
      await this.draftApiService.apiCreateTable({
        revisionId,
        tableId: migration.tableId,
        schema: migration.schema,
      });
    } else if (migration.changeType === 'rename') {
      await this.draftApiService.apiRenameTable({
        revisionId,
        tableId: migration.tableId,
        nextTableId: migration.nextTableId,
      });
    } else if (migration.changeType === 'remove') {
      await this.draftApiService.apiRemoveTable({
        revisionId,
        tableId: migration.tableId,
      });
    }
  }
}

function appliedResult(id: string): ApplyMigrationResult {
  return { id, status: 'applied' };
}

function unrecordedFailureOf(ended: EndedMigration | null): string {
  if (ended?.status === MigrationStatus.FAILED) {
    return ended.errorMessage ?? MigrationStatus.FAILED;
  }

  if (ended?.errorMessage) {
    return `${MigrationStatus.CANCELLED}: ${ended.errorMessage}`;
  }

  return MigrationStatus.CANCELLED;
}
