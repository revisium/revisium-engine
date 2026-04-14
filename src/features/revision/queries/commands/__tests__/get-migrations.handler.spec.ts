import { QueryBus } from '@nestjs/cqrs';
import objectHash from 'object-hash';
import { givenDraftProject } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import type { QueryTestKit } from 'src/__tests__/kit/create-query-test-kit';
import { createQueryTestKit } from 'src/__tests__/kit/create-query-test-kit';
import { testSchema } from 'src/features/draft/commands/handlers/__tests__/utils';
import {
  GetMigrationsQuery,
  GetMigrationsQueryReturnType,
} from 'src/features/revision/queries/impl';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

describe('GetMigrationsHandler', () => {
  it('should get migrations', async () => {
    const { draftRevisionId, tableId } = await givenDraftProject(prismaService);

    const result = await runTransaction(
      new GetMigrationsQuery({
        revisionId: draftRevisionId,
      }),
    );

    expect(result).toStrictEqual([
      {
        changeType: 'init',
        id: expect.any(String),
        hash: objectHash(testSchema),
        schema: testSchema,
        tableId,
      },
    ]);
  });

  function runTransaction(
    query: GetMigrationsQuery,
  ): Promise<GetMigrationsQueryReturnType> {
    return transactionService.run(async () => queryBus.execute(query));
  }

  let kit: QueryTestKit;
  let prismaService: PrismaService;
  let transactionService: TransactionPrismaService;
  let queryBus: QueryBus;

  beforeAll(async () => {
    kit = await createQueryTestKit();
    prismaService = kit.prismaService;
    transactionService = kit.transactionService;
    queryBus = kit.queryBus;
  });

  afterAll(async () => {
    await kit.close();
  });
});
