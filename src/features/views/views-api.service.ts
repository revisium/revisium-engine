import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { MigrationLockService } from 'src/features/migration/services/migration-lock.service';
import {
  UpdateTableViewsCommand,
  UpdateTableViewsCommandData,
} from 'src/features/views/commands/impl';
import {
  GetTableViewsQuery,
  GetTableViewsQueryData,
  GetTableViewsQueryReturnType,
} from 'src/features/views/queries/impl';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@Injectable()
export class ViewsApiService {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly commandBus: CommandBus,
    private readonly transactionService: TransactionPrismaService,
    private readonly migrationLockService: MigrationLockService,
  ) {}

  public getTableViews(
    data: GetTableViewsQueryData,
  ): Promise<GetTableViewsQueryReturnType> {
    return this.queryBus.execute<
      GetTableViewsQuery,
      GetTableViewsQueryReturnType
    >(new GetTableViewsQuery(data));
  }

  public updateTableViews(data: UpdateTableViewsCommandData): Promise<boolean> {
    return this.transactionService.runSerializable(async () => {
      await this.migrationLockService.checkRevisionLock(data.revisionId);

      return this.commandBus.execute<UpdateTableViewsCommand, boolean>(
        new UpdateTableViewsCommand(data),
      );
    });
  }
}
