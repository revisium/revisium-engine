import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import { ResolveRowCountForeignKeysByQuery } from 'src/features/row/queries/impl';
import { ForeignKeysService } from 'src/features/share/foreign-keys.service';
import { CustomSchemeKeywords } from 'src/features/share/schema/consts';
import { ShareTransactionalQueries } from 'src/features/share/share.transactional.queries';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { getForeignKeyJsonPaths } from 'src/features/share/utils/get-foreign-key-json-paths';

@QueryHandler(ResolveRowCountForeignKeysByQuery)
export class ResolveRowCountForeignKeysByHandler implements IQueryHandler<
  ResolveRowCountForeignKeysByQuery,
  number
> {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly shareTransactionalQueries: ShareTransactionalQueries,
    private readonly foreignKeysService: ForeignKeysService,
    private readonly jsonSchemaStore: JsonSchemaStoreService,
  ) {}

  private get transaction() {
    return this.transactionService.getTransaction();
  }

  async execute({ data }: ResolveRowCountForeignKeysByQuery) {
    return this.transactionService.runSerializable(() =>
      this.transactionHandler(data),
    );
  }

  private async transactionHandler(
    data: ResolveRowCountForeignKeysByQuery['data'],
  ) {
    const schemaTable =
      await this.shareTransactionalQueries.findTableInRevisionOrThrow(
        data.revisionId,
        SystemTables.Schema,
      );

    const foreignKeyTableIds = (
      await this.foreignKeysService.findRowsByKeyValueInData(
        schemaTable.versionId,
        CustomSchemeKeywords.ForeignKey,
        data.tableId,
      )
    ).map((row) => row.id);

    const results = await Promise.all(
      foreignKeyTableIds.map((foreignKeyTableId) =>
        this.getCountByForeignKeyTableId(
          data.revisionId,
          data.rowId,
          data.tableId,
          foreignKeyTableId,
        ),
      ),
    );

    return results.reduce((sum, result) => {
      return sum + result;
    }, 0);
  }

  async getCountByForeignKeyTableId(
    revisionId: string,
    rowId: string,
    targetTableId: string,
    foreignKeyTableId: string,
  ) {
    const foreignKeyTable =
      await this.shareTransactionalQueries.findTableInRevisionOrThrow(
        revisionId,
        foreignKeyTableId,
      );

    const { schema } = await this.shareTransactionalQueries.getTableSchema(
      revisionId,
      foreignKeyTableId,
    );

    return this.foreignKeysService.countRowsByPathsAndValueInData(
      foreignKeyTable.versionId,
      getForeignKeyJsonPaths(
        this.jsonSchemaStore.create(schema),
        targetTableId,
      ),
      rowId,
    );
  }
}
