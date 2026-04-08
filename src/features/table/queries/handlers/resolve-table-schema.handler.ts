import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { type JsonValue } from 'src/engine-prisma-types';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import { ShareTransactionalQueries } from 'src/features/share/share.transactional.queries';
import { findSchemaForSystemTables } from 'src/features/share/system-tables.consts';
import { ResolveTableSchemaQuery } from 'src/features/table/queries/impl';

@QueryHandler(ResolveTableSchemaQuery)
export class ResolveTableSchemaHandler implements IQueryHandler<ResolveTableSchemaQuery> {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly shareTransactionalQueries: ShareTransactionalQueries,
  ) {}

  private get transaction() {
    return this.transactionService.getTransaction();
  }

  async execute({ data }: ResolveTableSchemaQuery): Promise<JsonValue> {
    return this.transactionService.runSerializable(() =>
      this.transactionHandler(data),
    );
  }

  private async transactionHandler(data: ResolveTableSchemaQuery['data']) {
    const foundSystemMetaSchema = findSchemaForSystemTables(data.tableId);

    if (foundSystemMetaSchema) {
      return foundSystemMetaSchema;
    }

    const result = await this.shareTransactionalQueries.getTableSchema(
      data.revisionId,
      data.tableId,
    );

    return result.schema;
  }
}
