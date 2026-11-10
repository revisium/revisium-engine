import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { listingRequestOf } from 'src/features/partial-changes/listing/listing-request';
import { UnitListing } from 'src/features/partial-changes/listing/unit-listing';
import { PartialOperationLog } from 'src/features/partial-changes/logging/partial-operation-log';
import {
  type ListChangesResult,
  ListDraftChangesQuery,
} from 'src/features/partial-changes/queries/impl/list-draft-changes.query';
import { OperationTransactionRunner } from 'src/infrastructure/database/operation-transaction-runner';

@QueryHandler(ListDraftChangesQuery)
export class ListDraftChangesHandler implements IQueryHandler<
  ListDraftChangesQuery,
  ListChangesResult
> {
  constructor(
    private readonly transactionRunner: OperationTransactionRunner,
    private readonly unitListing: UnitListing,
    private readonly operationLog: PartialOperationLog,
  ) {}

  public execute({ data }: ListDraftChangesQuery): Promise<ListChangesResult> {
    return this.operationLog.track('list', data.branch, async (trace) => {
      const request = listingRequestOf(data);
      const page = await this.transactionRunner.runPlanning(
        () => this.unitListing.listPage(request),
        trace,
      );
      trace.planned(page);

      return page;
    });
  }
}
