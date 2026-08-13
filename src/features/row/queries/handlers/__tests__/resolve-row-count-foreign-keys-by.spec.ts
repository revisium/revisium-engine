import { QueryBus } from '@nestjs/cqrs';
import type { QueryTestKit } from 'src/__tests__/kit/create-query-test-kit';
import { createQueryTestKit } from 'src/__tests__/kit/create-query-test-kit';
import { prepareRow } from 'src/__tests__/utils/prepareProject';
import { ResolveRowCountForeignKeysByQuery } from 'src/features/row/queries/impl';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import {
  givenForeignKeysByScenario,
  givenMixedPeopleTasksScenario,
} from './row-query.spec-helper';

describe('ResolveRowCountForeignKeysByHandler', () => {
  it('should count rows that actually reference the target', async () => {
    const { draftRevisionId, table, rowId } =
      await givenForeignKeysByScenario(kit);

    const count = await countIncoming({
      revisionId: draftRevisionId,
      tableId: table.tableId,
      rowId,
    });

    expect(count).toBe(1);
  });

  it('should return 0 when nobody references the row', async () => {
    const { draftRevisionId, table } = await givenForeignKeysByScenario(kit);

    const count = await countIncoming({
      revisionId: draftRevisionId,
      tableId: table.tableId,
      rowId: 'missing-row',
    });

    expect(count).toBe(0);
  });

  it('should not count a foreign key to another table as an incoming reference', async () => {
    const { draftRevisionId, peopleTableId, tasksTableId } =
      await givenMixedPeopleTasksScenario(kit);

    const taskCount = await countIncoming({
      revisionId: draftRevisionId,
      tableId: tasksTableId,
      rowId: 'alex',
    });
    const personCount = await countIncoming({
      revisionId: draftRevisionId,
      tableId: peopleTableId,
      rowId: 'alex',
    });

    expect(taskCount).toBe(0);
    expect(personCount).toBe(2);
  });

  it('should still count a real self-reference in the same table', async () => {
    const {
      draftRevisionId,
      tasksTableId,
      tasksSchema,
      tasksHeadTableVersionId,
      tasksDraftTableVersionId,
    } = await givenMixedPeopleTasksScenario(kit);

    await prepareRow({
      prismaService: kit.prismaService,
      headTableVersionId: tasksHeadTableVersionId,
      draftTableVersionId: tasksDraftTableVersionId,
      rowId: 'task-3',
      data: { blockedBy: ['alex'], assignee: 'alex' },
      dataDraft: { blockedBy: ['alex'], assignee: 'alex' },
      schema: tasksSchema,
    });

    const count = await countIncoming({
      revisionId: draftRevisionId,
      tableId: tasksTableId,
      rowId: 'alex',
    });

    expect(count).toBe(1);
  });

  function countIncoming(data: {
    revisionId: string;
    tableId: string;
    rowId: string;
  }) {
    return transactionService.run(() =>
      queryBus.execute(new ResolveRowCountForeignKeysByQuery(data)),
    );
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
