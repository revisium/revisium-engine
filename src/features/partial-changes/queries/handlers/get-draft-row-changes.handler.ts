import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { rowChangesRequestOf } from 'src/features/partial-changes/draft-reads/draft-read-request';
import { DraftRowPages } from 'src/features/partial-changes/draft-reads/draft-row-pages';
import {
  type DraftRowPage,
  GetDraftRowChangesQuery,
} from 'src/features/partial-changes/queries/impl/get-draft-row-changes.query';
import { OperationTransactionRunner } from 'src/infrastructure/database/operation-transaction-runner';

@QueryHandler(GetDraftRowChangesQuery)
export class GetDraftRowChangesHandler implements IQueryHandler<
  GetDraftRowChangesQuery,
  DraftRowPage
> {
  constructor(
    private readonly transactionRunner: OperationTransactionRunner,
    private readonly rowPages: DraftRowPages,
  ) {}

  public execute({ data }: GetDraftRowChangesQuery): Promise<DraftRowPage> {
    const request = rowChangesRequestOf(data);

    return this.transactionRunner.runPlanning(() =>
      this.rowPages.readPage(request),
    );
  }
}
