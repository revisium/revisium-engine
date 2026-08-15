import { BadRequestException } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
  GetPreviousRowStatesQuery,
  type GetPreviousRowStatesQueryReturnType,
} from 'src/features/row/queries/impl/get-previous-row-states.query';
import {
  parsePreviousRowStatesRequest,
  throwPreviousRowStatesCursorScopeError,
} from 'src/features/row/previous-row-states/previous-row-states.request';
import { interpretPreviousRowStatesResult } from 'src/features/row/previous-row-states/previous-row-states.result';
import {
  getHistorySelectorSql,
  getPreviousRowStatesSql,
  type HistorySelectorSqlResult,
  type PreviousRowStateSqlResult,
} from 'src/features/row/previous-row-states/sql/get-previous-row-states.sql';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@QueryHandler(GetPreviousRowStatesQuery)
export class GetPreviousRowStatesHandler implements IQueryHandler<
  GetPreviousRowStatesQuery,
  GetPreviousRowStatesQueryReturnType
> {
  constructor(private readonly transactionService: TransactionPrismaService) {}

  private get prisma() {
    return this.transactionService.getTransactionOrPrisma();
  }

  async execute({
    data,
  }: GetPreviousRowStatesQuery): Promise<GetPreviousRowStatesQueryReturnType> {
    const request = parsePreviousRowStatesRequest(data);
    const [selector] = await this.prisma.$queryRaw<HistorySelectorSqlResult[]>(
      getHistorySelectorSql({
        revisionId: request.revisionId,
        tableId: request.tableId,
        rowId: request.rowId,
      }),
    );

    if (!selector) {
      if (request.after) {
        throwPreviousRowStatesCursorScopeError();
      }
      return null;
    }

    if (selector.tipIsDraft) {
      throw new BadRequestException(
        'Previous row states require a committed revision',
      );
    }

    if (selector.selectorCount === 0) {
      if (request.after) {
        throwPreviousRowStatesCursorScopeError();
      }
      return null;
    }

    if (
      selector.selectorCount !== 1 ||
      !selector.tableCreatedId ||
      !selector.rowCreatedId
    ) {
      throw new BadRequestException(
        'Selected row snapshot must resolve exactly once',
      );
    }

    const rows = await this.prisma.$queryRaw<PreviousRowStateSqlResult[]>(
      getPreviousRowStatesSql({
        tipBranchId: selector.tipBranchId,
        tipSequence: selector.tipSequence,
        projectId: selector.projectId,
        tableCreatedId: selector.tableCreatedId,
        rowCreatedId: selector.rowCreatedId,
        rowVersionCount: selector.rowVersionCount,
        first: request.first,
        afterSequence: request.after?.sequence ?? null,
        afterRevisionId: request.after?.eventRevisionId ?? null,
      }),
    );

    return interpretPreviousRowStatesResult({
      request,
      selector: {
        tableCreatedId: selector.tableCreatedId,
        rowCreatedId: selector.rowCreatedId,
      },
      rows,
    });
  }
}
