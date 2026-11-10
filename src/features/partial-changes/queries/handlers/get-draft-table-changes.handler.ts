import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { tableChangesRequestOf } from 'src/features/partial-changes/draft-reads/draft-read-request';
import { DraftTablePages } from 'src/features/partial-changes/draft-reads/draft-table-pages';
import {
  type DraftTablePage,
  GetDraftTableChangesQuery,
} from 'src/features/partial-changes/queries/impl/get-draft-table-changes.query';
import { OperationTransactionRunner } from 'src/infrastructure/database/operation-transaction-runner';

@QueryHandler(GetDraftTableChangesQuery)
export class GetDraftTableChangesHandler implements IQueryHandler<
  GetDraftTableChangesQuery,
  DraftTablePage
> {
  constructor(
    private readonly transactionRunner: OperationTransactionRunner,
    private readonly tablePages: DraftTablePages,
  ) {}

  public execute({ data }: GetDraftTableChangesQuery): Promise<DraftTablePage> {
    const request = tableChangesRequestOf(data);

    return this.transactionRunner.runPlanning(() =>
      this.tablePages.readPage(request),
    );
  }
}
