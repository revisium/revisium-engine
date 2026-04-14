import { QueryBus } from '@nestjs/cqrs';
import { nanoid } from 'nanoid';
import type { BranchTestKit } from 'src/__tests__/kit/create-branch-test-kit';
import { createBranchTestKit } from 'src/__tests__/kit/create-branch-test-kit';
import {
  GetBranchesQuery,
  GetBranchesQueryReturnType,
} from 'src/features/branch/quieries/impl';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

describe('GetBranchesHandler', () => {
  it('should get branches', async () => {
    const { projectId } = await prepareProjectWithBranch();

    const result = await runTransaction(
      new GetBranchesQuery({
        projectId,
        first: 100,
      }),
    );

    expect(result.totalCount).toBe(1);
  });

  async function prepareProjectWithBranch() {
    const projectId = nanoid();
    const branchId = nanoid();
    const headRevisionId = nanoid();
    const draftRevisionId = nanoid();

    await prismaService.branch.create({
      data: {
        id: branchId,
        name: 'master',
        isRoot: true,
        projectId,
        revisions: {
          createMany: {
            data: [
              { id: headRevisionId, isHead: true, isStart: true },
              {
                id: draftRevisionId,
                parentId: headRevisionId,
                isDraft: true,
              },
            ],
          },
        },
      },
    });

    return { projectId, branchId };
  }

  function runTransaction(
    query: GetBranchesQuery,
  ): Promise<GetBranchesQueryReturnType> {
    return transactionService.run(async () => queryBus.execute(query));
  }

  let kit: BranchTestKit;
  let prismaService: PrismaService;
  let transactionService: TransactionPrismaService;
  let queryBus: QueryBus;

  beforeAll(async () => {
    kit = await createBranchTestKit();
    prismaService = kit.prismaService;
    transactionService = kit.transactionService;
    queryBus = kit.queryBus;
  });

  afterAll(async () => {
    await kit.close();
  });
});
