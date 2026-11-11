import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
  presentFiltersOf,
  tableChangesRequestOf,
} from 'src/features/partial-changes/draft-reads/draft-read-request';
import { DraftTablePages } from 'src/features/partial-changes/draft-reads/draft-table-pages';
import {
  partialOperation,
  plannedFieldsOf,
} from 'src/features/partial-changes/logging/partial-operation-fields';
import {
  type DraftTablePage,
  GetDraftTableChangesQuery,
} from 'src/features/partial-changes/queries/impl/get-draft-table-changes.query';
import { OperationLog } from 'src/infrastructure/database/operation-log';
import { OperationTransactionRunner } from 'src/infrastructure/database/operation-transaction-runner';

@QueryHandler(GetDraftTableChangesQuery)
export class GetDraftTableChangesHandler implements IQueryHandler<
  GetDraftTableChangesQuery,
  DraftTablePage
> {
  constructor(
    private readonly transactionRunner: OperationTransactionRunner,
    private readonly tablePages: DraftTablePages,
    private readonly operationLog: OperationLog,
  ) {}

  public execute({ data }: GetDraftTableChangesQuery): Promise<DraftTablePage> {
    return this.operationLog.track(
      partialOperation('tableChanges', data.branch),
      async (trace) => {
        const request = tableChangesRequestOf(data);
        const page = await this.transactionRunner.runPlanning(
          () => this.tablePages.readPage(request),
          trace,
        );
        trace.planned(() => plannedFieldsOf(page));
        trace.described(() => ({
          pageSize: request.first,
          returned: page.edges.length,
          filters: presentFiltersOf(request.filters),
        }));

        return page;
      },
    );
  }
}
