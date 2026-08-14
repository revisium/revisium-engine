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
  getPreviousRowStatesSql,
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
    const selectedRevision = await this.prisma.revision.findUnique({
      where: { id: request.revisionId },
      select: { isDraft: true },
    });

    if (!selectedRevision) {
      if (request.after) {
        throwPreviousRowStatesCursorScopeError();
      }
      return null;
    }

    if (selectedRevision.isDraft) {
      throw new BadRequestException(
        'Previous row states require a committed revision',
      );
    }

    const rows = await this.prisma.$queryRaw<PreviousRowStateSqlResult[]>(
      getPreviousRowStatesSql({
        revisionId: request.revisionId,
        tableId: request.tableId,
        rowId: request.rowId,
        first: request.first,
        afterDepth: request.after?.depth ?? null,
        afterRevisionId: request.after?.eventRevisionId ?? null,
      }),
    );

    return interpretPreviousRowStatesResult({ request, rows });
  }
}
