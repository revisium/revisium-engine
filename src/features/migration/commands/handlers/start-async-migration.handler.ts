import { BadRequestException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { StartAsyncMigrationCommand } from 'src/features/migration/commands/impl/start-async-migration.command';
import { MigrationService } from 'src/features/migration/services/migration.service';
import { MigrationWorkerService } from 'src/features/migration/services/migration-worker.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import { ShareTransactionalQueries } from 'src/features/share/share.transactional.queries';
import { StartAsyncMigrationResult } from 'src/features/migration/types/migration.types';
import { InputJsonValue } from 'src/engine-prisma-types';
import { SchemaTable } from '@revisium/schema-toolkit/lib';

@CommandHandler(StartAsyncMigrationCommand)
export class StartAsyncMigrationHandler implements ICommandHandler<
  StartAsyncMigrationCommand,
  StartAsyncMigrationResult
> {
  constructor(
    private readonly migrationService: MigrationService,
    private readonly workerService: MigrationWorkerService,
    private readonly transactionService: TransactionPrismaService,
    private readonly jsonSchemaStore: JsonSchemaStoreService,
    private readonly jsonSchemaValidator: JsonSchemaValidatorService,
    private readonly shareTransactionalQueries: ShareTransactionalQueries,
  ) {}

  async execute({
    data,
  }: StartAsyncMigrationCommand): Promise<StartAsyncMigrationResult> {
    const { revisionId, tableId, patches } = data;

    const migrationId = await this.transactionService.runSerializable(
      async () => {
        const tx = this.transactionService.getTransaction();
        const revision = await tx.revision.findUniqueOrThrow({
          where: { id: revisionId },
        });
        if (!revision.isDraft) {
          throw new BadRequestException('Revision is not a draft');
        }

        const table =
          await this.shareTransactionalQueries.findTableInRevisionOrThrow(
            revisionId,
            tableId,
          );

        const { schema: previousSchema, hash: previousSchemaHash } =
          await this.shareTransactionalQueries.getTableSchema(
            revisionId,
            tableId,
          );

        let targetSchema: ReturnType<SchemaTable['getSchema']>;
        try {
          const schemaTable = new SchemaTable(
            previousSchema,
            this.jsonSchemaStore.refs,
          );
          schemaTable.applyPatches(patches);
          targetSchema = schemaTable.getSchema();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          throw new BadRequestException(`invalid schema patches: ${message}`);
        }

        const { result, errors } = this.jsonSchemaValidator.validateMetaSchema(
          targetSchema as InputJsonValue,
        );
        if (!result) {
          const details = (errors ?? [])
            .map((e) => `${e.instancePath} ${e.message ?? '<no message>'}`)
            .join('; ');
          throw new BadRequestException(`schema is not valid: ${details}`);
        }

        const targetSchemaHash =
          this.jsonSchemaValidator.getSchemaHash(targetSchema);

        const totalRows = await this.migrationService.countRows(
          table.versionId,
          tx,
        );

        const id = await this.migrationService.createMigrationRecord({
          revisionId,
          tableId,
          sourceTableVersionId: table.versionId,
          patches,
          previousSchema: previousSchema as InputJsonValue,
          previousSchemaHash,
          targetSchemaHash,
          totalRows,
        });

        return id;
      },
    );

    await this.workerService.triggerInline(migrationId);

    return { migrationId, status: 'migrating' };
  }
}
