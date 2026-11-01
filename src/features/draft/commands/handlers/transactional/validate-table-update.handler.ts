import { CommandBus, CommandHandler } from '@nestjs/cqrs';
import { SchemaTable } from '@revisium/schema-toolkit/lib';
import type { JsonPatch, JsonSchema } from '@revisium/schema-toolkit/types';
import { MigrateTableViewsCommand } from 'src/features/draft/commands/impl/transactional/migrate-table-views.command';
import { UpdateSchemaCommand } from 'src/features/draft/commands/impl/transactional/update-schema.command';
import {
  ValidateTableUpdateCommand,
  ValidateTableUpdateCommandReturnType,
} from 'src/features/draft/commands/impl/transactional/validate-table-update.command';
import { DraftContextService } from 'src/features/draft/draft-context.service';
import { DraftHandler } from 'src/features/draft/draft.handler';
import { DraftTransactionalCommands } from 'src/features/draft/draft.transactional.commands';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { ShareTransactionalQueries } from 'src/features/share/share.transactional.queries';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@CommandHandler(ValidateTableUpdateCommand)
export class ValidateTableUpdateHandler extends DraftHandler<
  ValidateTableUpdateCommand,
  ValidateTableUpdateCommandReturnType
> {
  constructor(
    protected readonly transactionService: TransactionPrismaService,
    protected readonly draftContext: DraftContextService,
    private readonly commandBus: CommandBus,
    private readonly draftTransactionalCommands: DraftTransactionalCommands,
    private readonly shareTransactionalQueries: ShareTransactionalQueries,
    private readonly jsonSchemaStore: JsonSchemaStoreService,
  ) {
    super(transactionService, draftContext);
  }

  protected async handler({
    data,
  }: ValidateTableUpdateCommand): Promise<ValidateTableUpdateCommandReturnType> {
    const { revisionId, tableId, patches } = data;

    await this.draftTransactionalCommands.resolveDraftRevision(revisionId);
    await this.draftTransactionalCommands.validateTablePatches(
      tableId,
      patches,
    );
    await this.draftTransactionalCommands.validateNotSystemTable(tableId);

    const { schema: previousSchema } =
      await this.shareTransactionalQueries.getTableSchema(revisionId, tableId);
    const targetSchema = this.applyPatches(previousSchema, patches);

    await this.draftTransactionalCommands.validateSchema(targetSchema, tableId);
    await this.dryRunSchemaUpdate(data, targetSchema);
    await this.dryRunViewsMigration(data, previousSchema);

    return { targetSchema };
  }

  private applyPatches(schema: JsonSchema, patches: JsonPatch[]): JsonSchema {
    const schemaTable = new SchemaTable(schema, this.jsonSchemaStore.refs);
    schemaTable.applyPatches(patches);

    return schemaTable.getSchema();
  }

  private dryRunSchemaUpdate(
    data: ValidateTableUpdateCommand['data'],
    targetSchema: JsonSchema,
  ): Promise<boolean> {
    return this.commandBus.execute<UpdateSchemaCommand, boolean>(
      new UpdateSchemaCommand({
        revisionId: data.revisionId,
        tableId: data.tableId,
        schema: targetSchema,
        patches: data.patches,
        dryRun: true,
      }),
    );
  }

  private dryRunViewsMigration(
    data: ValidateTableUpdateCommand['data'],
    previousSchema: JsonSchema,
  ): Promise<void> {
    return this.commandBus.execute<MigrateTableViewsCommand, void>(
      new MigrateTableViewsCommand({
        revisionId: data.revisionId,
        tableId: data.tableId,
        patches: data.patches,
        previousSchema,
        dryRun: true,
      }),
    );
  }
}
