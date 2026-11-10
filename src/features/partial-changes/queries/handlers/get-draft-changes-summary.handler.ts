import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { summaryRequestOf } from 'src/features/partial-changes/draft-reads/draft-read-request';
import { DraftChangesSummaryReader } from 'src/features/partial-changes/draft-reads/draft-changes-summary';
import {
  type DraftChangesSummary,
  GetDraftChangesSummaryQuery,
} from 'src/features/partial-changes/queries/impl/get-draft-changes-summary.query';
import { OperationTransactionRunner } from 'src/infrastructure/database/operation-transaction-runner';

@QueryHandler(GetDraftChangesSummaryQuery)
export class GetDraftChangesSummaryHandler implements IQueryHandler<
  GetDraftChangesSummaryQuery,
  DraftChangesSummary
> {
  constructor(
    private readonly transactionRunner: OperationTransactionRunner,
    private readonly summaryReader: DraftChangesSummaryReader,
  ) {}

  public execute({
    data,
  }: GetDraftChangesSummaryQuery): Promise<DraftChangesSummary> {
    const request = summaryRequestOf(data);

    return this.transactionRunner.runPlanning(() =>
      this.summaryReader.read(request),
    );
  }
}
