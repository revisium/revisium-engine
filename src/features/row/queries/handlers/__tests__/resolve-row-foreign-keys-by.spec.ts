import { QueryBus } from '@nestjs/cqrs';
import type { QueryTestKit } from 'src/__tests__/kit/create-query-test-kit';
import { createQueryTestKit } from 'src/__tests__/kit/create-query-test-kit';
import {
  ResolveRowForeignKeysByQuery,
  ResolveRowForeignKeysByReturnType,
} from 'src/features/row/queries/impl';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import {
  givenForeignKeysByScenario,
  givenMixedPeopleTasksScenario,
} from './row-query.spec-helper';

describe('ResolveRowForeignKeysByHandler', () => {
  it('should compute rows', async () => {
    const { draftRevisionId, table, byTable, rowId } =
      await givenForeignKeysByScenario(kit);

    const result = await runTransaction(
      new ResolveRowForeignKeysByQuery({
        revisionId: draftRevisionId,
        tableId: table.tableId,
        rowId,
        first: 100,
        foreignKeyByTableId: byTable.tableId,
      }),
    );

    expect(result.totalCount).toEqual(1);

    const resultData = (result.edges[0] as (typeof result.edges)[number]).node
      .data as { file: { url: string } };
    expect(resultData.file.url).toBeTruthy();
  });

  it('should not treat a foreign key to another table as an incoming reference', async () => {
    const { draftRevisionId, peopleTableId, tasksTableId } =
      await givenMixedPeopleTasksScenario(kit);

    const taskIncoming = await runTransaction(
      new ResolveRowForeignKeysByQuery({
        revisionId: draftRevisionId,
        tableId: tasksTableId,
        rowId: 'alex',
        first: 100,
        foreignKeyByTableId: tasksTableId,
      }),
    );
    const personIncoming = await runTransaction(
      new ResolveRowForeignKeysByQuery({
        revisionId: draftRevisionId,
        tableId: peopleTableId,
        rowId: 'alex',
        first: 100,
        foreignKeyByTableId: tasksTableId,
      }),
    );

    expect(taskIncoming.totalCount).toEqual(0);
    expect(taskIncoming.edges).toHaveLength(0);
    expect(personIncoming.totalCount).toEqual(2);
    expect(personIncoming.edges.map((edge) => edge.node.id).sort()).toEqual([
      'alex',
      'task-2',
    ]);
  });

  function runTransaction(
    query: ResolveRowForeignKeysByQuery,
  ): Promise<ResolveRowForeignKeysByReturnType> {
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
