import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { listingRequestOf } from 'src/features/partial-changes/listing/listing-request';
import { UnitListing } from 'src/features/partial-changes/listing/unit-listing';
import {
  partialOperation,
  plannedFieldsOf,
} from 'src/features/partial-changes/logging/partial-operation-fields';
import {
  type ListChangesResult,
  ListDraftChangesQuery,
} from 'src/features/partial-changes/queries/impl/list-draft-changes.query';
import { OperationLog } from 'src/infrastructure/database/operation-log';
import { OperationTransactionRunner } from 'src/infrastructure/database/operation-transaction-runner';

@QueryHandler(ListDraftChangesQuery)
export class ListDraftChangesHandler implements IQueryHandler<
  ListDraftChangesQuery,
  ListChangesResult
> {
  constructor(
    private readonly transactionRunner: OperationTransactionRunner,
    private readonly unitListing: UnitListing,
    private readonly operationLog: OperationLog,
  ) {}

  public execute({ data }: ListDraftChangesQuery): Promise<ListChangesResult> {
    return this.operationLog.track(
      partialOperation('list', data.branch),
      async (trace) => {
        const request = listingRequestOf(data);
        const page = await this.transactionRunner.runPlanning(
          () => this.unitListing.listPage(request),
          trace,
        );
        trace.planned(() => plannedFieldsOf(page));

        return page;
      },
    );
  }
}
