import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { TransactionIsolationLevel } from 'src/engine-prisma-types';
import { ChangePlanner } from 'src/features/partial-changes-poc/planning/change-planner.service';
import { toPreviewResult } from 'src/features/partial-changes-poc/planning/plan-outcome';
import {
  PreviewChangesQuery,
  PreviewChangesQueryReturnType,
} from 'src/features/partial-changes-poc/queries/impl/preview-changes.query';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@QueryHandler(PreviewChangesQuery)
export class PreviewChangesHandler implements IQueryHandler<
  PreviewChangesQuery,
  PreviewChangesQueryReturnType
> {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly planner: ChangePlanner,
  ) {}

  execute({
    data,
  }: PreviewChangesQuery): Promise<PreviewChangesQueryReturnType> {
    return this.transactionService.run(() => this.preview(data), {
      isolationLevel: TransactionIsolationLevel.RepeatableRead,
    });
  }

  private async preview(
    data: PreviewChangesQuery['data'],
  ): Promise<PreviewChangesQueryReturnType> {
    const plan = await this.planner.plan(data);
    return toPreviewResult(plan, Boolean(data.includeRequired));
  }
}
