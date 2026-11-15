import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { fieldValueRequestOf } from 'src/features/partial-changes/draft-reads/draft-read-request';
import { DraftFieldValues } from 'src/features/partial-changes/draft-reads/draft-field-values';
import {
  partialOperation,
  plannedFieldsOf,
} from 'src/features/partial-changes/logging/partial-operation-fields';
import {
  type DraftFieldValue,
  GetDraftFieldValueQuery,
} from 'src/features/partial-changes/queries/impl/get-draft-field-value.query';
import { OperationLog } from 'src/infrastructure/database/operation-log';
import { OperationTransactionRunner } from 'src/infrastructure/database/operation-transaction-runner';

@QueryHandler(GetDraftFieldValueQuery)
export class GetDraftFieldValueHandler implements IQueryHandler<
  GetDraftFieldValueQuery,
  DraftFieldValue
> {
  constructor(
    private readonly transactionRunner: OperationTransactionRunner,
    private readonly fieldValues: DraftFieldValues,
    private readonly operationLog: OperationLog,
  ) {}

  public execute({ data }: GetDraftFieldValueQuery): Promise<DraftFieldValue> {
    return this.operationLog.track(
      partialOperation('fieldValue', data.branch),
      async (trace) => {
        const request = fieldValueRequestOf(data);
        const value = await this.transactionRunner.runPlanning(
          () => this.fieldValues.readValue(request),
          trace,
        );
        trace.planned(() => plannedFieldsOf(value));
        trace.described(() => ({
          side: request.side,
          valueBytes: value.valueBytes,
        }));

        return value;
      },
    );
  }
}
