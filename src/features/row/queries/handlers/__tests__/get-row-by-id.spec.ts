import { QueryBus } from '@nestjs/cqrs';
import type { QueryTestKit } from 'src/__tests__/kit/create-query-test-kit';
import { createQueryTestKit } from 'src/__tests__/kit/create-query-test-kit';
import {
  GetRowByIdQuery,
  GetRowByIdQueryReturnType,
} from 'src/features/row/queries/impl';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import { givenRowByIdScenario } from './row-query.spec-helper';

describe('getRowById', () => {
  it('should compute rows', async () => {
    const { draftRevisionId, table, rowDraft } =
      await givenRowByIdScenario(kit);

    const result = await runTransaction(
      new GetRowByIdQuery({
        revisionId: draftRevisionId,
        tableId: table.tableId,
        rowId: rowDraft.id,
        rowVersionId: rowDraft.versionId,
      }),
    );

    const resultData = result?.data as { file: { url: string } };

    expect(resultData.file.url).toBeTruthy();
  });

  function runTransaction(
    query: GetRowByIdQuery,
  ): Promise<GetRowByIdQueryReturnType> {
    return transactionService.run(async () => queryBus.execute(query));
  }

  let kit: QueryTestKit;
  let transactionService: TransactionPrismaService;
  let queryBus: QueryBus;

  beforeAll(async () => {
    kit = await createQueryTestKit();
    transactionService = kit.transactionService;
    queryBus = kit.queryBus;
  });

  afterAll(async () => {
    await kit.close();
  });
});
