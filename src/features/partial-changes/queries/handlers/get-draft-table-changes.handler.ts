import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
  presentFiltersOf,
  tableChangesRequestOf,
} from 'src/features/partial-changes/draft-reads/draft-read-request';
import { DraftTablePages } from 'src/features/partial-changes/draft-reads/draft-table-pages';
import { PartialOperationLog } from 'src/features/partial-changes/logging/partial-operation-log';
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
    private readonly operationLog: PartialOperationLog,
  ) {}

  public execute({ data }: GetDraftTableChangesQuery): Promise<DraftTablePage> {
    return this.operationLog.track(
      'tableChanges',
      data.branch,
      async (trace) => {
        const request = tableChangesRequestOf(data);
        const page = await this.transactionRunner.runPlanning(
          () => this.tablePages.readPage(request),
          trace,
        );
        trace.planned(page);
        trace.described({
          pageSize: request.first,
          returned: page.edges.length,
          filters: presentFiltersOf(request.filters),
        });

        return page;
      },
    );
  }
}
