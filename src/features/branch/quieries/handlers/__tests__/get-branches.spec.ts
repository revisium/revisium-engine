import { CqrsModule, QueryBus } from '@nestjs/cqrs';
import { Test } from '@nestjs/testing';
import { nanoid } from 'nanoid';
import {
  GetBranchesQuery,
  GetBranchesQueryReturnType,
} from 'src/features/branch/quieries/impl';
import { BRANCH_QUERIES_HANDLERS } from 'src/features/branch/quieries/handlers';
import { ShareModule } from 'src/features/share/share.module';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
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

  let prismaService: PrismaService;
  let transactionService: TransactionPrismaService;
  let queryBus: QueryBus;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [DatabaseModule, CqrsModule, ShareModule],
      providers: [...BRANCH_QUERIES_HANDLERS],
    }).compile();

    await module.init();

    prismaService = module.get(PrismaService);
    transactionService = module.get(TransactionPrismaService);
    queryBus = module.get(QueryBus);
  });

  afterAll(async () => {
    await prismaService.$disconnect();
  });
});
