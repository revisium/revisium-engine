import { QueryBus } from '@nestjs/cqrs';
import {
  createPreviousFile,
  prepareTableAndRowWithFile,
} from 'src/__tests__/utils/prepareProject';
import type { QueryTestKit } from 'src/__tests__/kit/create-query-test-kit';
import { createQueryTestKit } from 'src/__tests__/kit/create-query-test-kit';
import { FileStatus } from 'src/features/plugin/file/consts';
import {
  GetRowByIdQuery,
  GetRowByIdQueryReturnType,
} from 'src/features/row/queries/impl';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

describe('getRowById', () => {
  it('should compute rows', async () => {
    const data = {
      file: {
        ...createPreviousFile(),
        status: FileStatus.uploaded,
        url: '',
      },
      files: [],
    };

    const { draftRevisionId, table, rowDraft } =
      await prepareTableAndRowWithFile(prismaService, data);

    const result = await runTransaction(
      new GetRowByIdQuery({
        revisionId: draftRevisionId,
        tableId: table.tableId,
        rowId: rowDraft.id,
        rowVersionId: rowDraft.versionId,
      }),
    );

    const resultData = result?.data as typeof data;

    expect(resultData.file.url).toBeTruthy();
  });

  function runTransaction(
    query: GetRowByIdQuery,
  ): Promise<GetRowByIdQueryReturnType> {
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
