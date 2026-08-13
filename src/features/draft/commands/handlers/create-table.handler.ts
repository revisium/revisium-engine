import { CommandBus, CommandHandler } from '@nestjs/cqrs';
import { CreateSchemaCommand } from 'src/features/draft/commands/impl/transactional/create-schema.command';
import { JsonSchema } from '@revisium/schema-toolkit/types';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import { CreateTableCommand } from 'src/features/draft/commands/impl/create-table.command';
import { CreateTableHandlerReturnType } from 'src/features/draft/commands/types/create-table.handler.types';
import { DraftContextService } from 'src/features/draft/draft-context.service';
import { DraftRevisionRequestDto } from 'src/features/draft/draft-request-dto/draft-revision-request.dto';
import { DraftHandler } from 'src/features/draft/draft.handler';
import { DraftTransactionalCommands } from 'src/features/draft/draft.transactional.commands';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import { DraftRevisionApiService } from 'src/features/draft-revision/draft-revision-api.service';

@CommandHandler(CreateTableCommand)
export class CreateTableHandler extends DraftHandler<
  CreateTableCommand,
  CreateTableHandlerReturnType
> {
  constructor(
    protected readonly transactionService: TransactionPrismaService,
    protected readonly draftContext: DraftContextService,
    protected readonly revisionRequestDto: DraftRevisionRequestDto,
    protected readonly draftTransactionalCommands: DraftTransactionalCommands,
    protected readonly commandBus: CommandBus,
    protected readonly jsonSchemaValidator: JsonSchemaValidatorService,
    protected readonly draftRevisionApi: DraftRevisionApiService,
  ) {
    super(transactionService, draftContext);
  }

  protected async handler({
    data,
  }: CreateTableCommand): Promise<CreateTableHandlerReturnType> {
    const { revisionId, tableId, schema } = data;

    await this.draftTransactionalCommands.resolveDraftRevision(revisionId);

    await this.draftTransactionalCommands.validateSchema(schema, tableId);

    const result = await this.draftRevisionApi.createTable({
      revisionId,
      tableId,
    });

    await this.saveSchema(data);

    return {
      branchId: this.revisionRequestDto.branchId,
      revisionId: this.revisionRequestDto.id,
      tableVersionId: result.tableVersionId,
    };
  }

  private async saveSchema({
    revisionId,
    tableId,
    schema,
  }: CreateTableCommand['data']) {
    await this.commandBus.execute(
      new CreateSchemaCommand({
        revisionId,
        tableId,
        data: schema as JsonSchema,
      }),
    );
    await this.jsonSchemaValidator.getOrAddValidateFunction(
      schema,
      this.jsonSchemaValidator.getSchemaHash(schema),
    );
  }
}
