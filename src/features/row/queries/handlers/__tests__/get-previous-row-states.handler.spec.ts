import { GetPreviousRowStatesHandler } from 'src/features/row/queries/handlers/get-previous-row-states.handler';
import { GetPreviousRowStatesQuery } from 'src/features/row/queries/impl';
import type { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

describe('GetPreviousRowStatesHandler', () => {
  it('returns null without executing history SQL when the revision is missing', async () => {
    const data = {
      revisionId: 'revision',
      tableId: 'table',
      rowId: 'row',
      first: 10,
    };
    const prisma = {
      revision: { findUnique: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn(),
    };
    const transactionService = {
      getTransactionOrPrisma: jest.fn().mockReturnValue(prisma),
    } as unknown as TransactionPrismaService;
    const handler = new GetPreviousRowStatesHandler(transactionService);

    await expect(
      handler.execute(new GetPreviousRowStatesQuery(data)),
    ).resolves.toBeNull();
    expect(prisma.revision.findUnique).toHaveBeenCalledWith({
      where: { id: 'revision' },
      select: { isDraft: true },
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
