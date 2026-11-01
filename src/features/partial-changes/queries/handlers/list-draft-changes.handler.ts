import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { listingRequestOf } from 'src/features/partial-changes/listing/listing-request';
import { UnitListing } from 'src/features/partial-changes/listing/unit-listing';
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
  ) {}

  public execute({ data }: ListDraftChangesQuery): Promise<ListChangesResult> {
    const request = listingRequestOf(data);

    return this.transactionRunner.runPlanning(() =>
      this.unitListing.listPage(request),
    );
  }
}
