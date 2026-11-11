import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
  presentFiltersOf,
  summaryRequestOf,
} from 'src/features/partial-changes/draft-reads/draft-read-request';
import { DraftChangesSummaryReader } from 'src/features/partial-changes/draft-reads/draft-changes-summary';
import {
  partialOperation,
  plannedFieldsOf,
} from 'src/features/partial-changes/logging/partial-operation-fields';
import {
  type DraftChangesSummary,
  GetDraftChangesSummaryQuery,
} from 'src/features/partial-changes/queries/impl/get-draft-changes-summary.query';
import { OperationLog } from 'src/infrastructure/database/operation-log';
import { OperationTransactionRunner } from 'src/infrastructure/database/operation-transaction-runner';

@QueryHandler(GetDraftChangesSummaryQuery)
export class GetDraftChangesSummaryHandler implements IQueryHandler<
  GetDraftChangesSummaryQuery,
  DraftChangesSummary
> {
  constructor(
    private readonly transactionRunner: OperationTransactionRunner,
    private readonly summaryReader: DraftChangesSummaryReader,
    private readonly operationLog: OperationLog,
  ) {}

  public execute({
    data,
  }: GetDraftChangesSummaryQuery): Promise<DraftChangesSummary> {
    return this.operationLog.track(
      partialOperation('summary', data.branch),
      async (trace) => {
        const request = summaryRequestOf(data);
        const summary = await this.transactionRunner.runPlanning(
          () => this.summaryReader.read(request),
          trace,
        );
        trace.planned(() => plannedFieldsOf(summary));
        trace.described(() => ({ filters: presentFiltersOf(request.filters) }));

        return summary;
      },
    );
  }
}
