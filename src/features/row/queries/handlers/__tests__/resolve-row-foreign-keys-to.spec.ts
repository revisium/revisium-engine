import { QueryBus } from '@nestjs/cqrs';
import type { QueryTestKit } from 'src/__tests__/kit/create-query-test-kit';
import { createQueryTestKit } from 'src/__tests__/kit/create-query-test-kit';
import {
  ResolveRowForeignKeysToQuery,
  ResolveRowForeignKeysToReturnType,
} from 'src/features/row/queries/impl';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import { givenForeignKeysToScenario } from './row-query.spec-helper';

describe('ResolveRowForeignKeysToHandler', () => {
  it('should compute rows', async () => {
    const { draftRevisionId, table, toTable, rowId } =
      await givenForeignKeysToScenario(kit);

    const result = await runTransaction(
      new ResolveRowForeignKeysToQuery({
        revisionId: draftRevisionId,
        tableId: table.tableId,
        rowId,
        first: 100,
        foreignKeyToTableId: toTable.tableId,
      }),
    );

    expect(result.totalCount).toEqual(1);

    const resultData = (result.edges[0] as (typeof result.edges)[number]).node
      .data as { title: string; file: { url: string } };
    expect(resultData.title).toBe('title');
    expect(resultData.file.url).toBeTruthy();
  });

  function runTransaction(
    query: ResolveRowForeignKeysToQuery,
  ): Promise<ResolveRowForeignKeysToReturnType> {
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
