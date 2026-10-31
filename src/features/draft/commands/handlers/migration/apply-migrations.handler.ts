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
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import { Migration } from '@revisium/schema-toolkit/types';
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
      await this.checkIdBeforeChange(revisionId);
      await this.changeTable(revisionId, migration);

      return {
        id: migration.id,
        status: 'applied',
      };
    } catch (error) {
      return this.unappliedResult(migration.id, error);
    }
  }

  private checkIdBeforeChange(revisionId: string) {
    // Table changes repeat this check in their transaction; an async update
    // has only this one. RepeatableRead gives both lookups one snapshot.
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
    } else if (migration.changeType === 'update') {
      await this.draftApiService.apiUpdateTable({
        revisionId,
        tableId: migration.tableId,
        patches: migration.patches,
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
