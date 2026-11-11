import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
  presentFiltersOf,
  rowChangesRequestOf,
} from 'src/features/partial-changes/draft-reads/draft-read-request';
import { DraftRowPages } from 'src/features/partial-changes/draft-reads/draft-row-pages';
import {
  partialOperation,
  plannedFieldsOf,
} from 'src/features/partial-changes/logging/partial-operation-fields';
import {
  type DraftRowPage,
  GetDraftRowChangesQuery,
} from 'src/features/partial-changes/queries/impl/get-draft-row-changes.query';
import { OperationLog } from 'src/infrastructure/database/operation-log';
import { OperationTransactionRunner } from 'src/infrastructure/database/operation-transaction-runner';

@QueryHandler(GetDraftRowChangesQuery)
export class GetDraftRowChangesHandler implements IQueryHandler<
  GetDraftRowChangesQuery,
  DraftRowPage
> {
  constructor(
    private readonly transactionRunner: OperationTransactionRunner,
    private readonly rowPages: DraftRowPages,
    private readonly operationLog: OperationLog,
  ) {}

  public execute({ data }: GetDraftRowChangesQuery): Promise<DraftRowPage> {
    return this.operationLog.track(
      partialOperation('rowChanges', data.branch),
      async (trace) => {
        const request = rowChangesRequestOf(data);
        const page = await this.transactionRunner.runPlanning(
          () => this.rowPages.readPage(request),
          trace,
        );
        trace.planned(plannedFieldsOf(page));
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
