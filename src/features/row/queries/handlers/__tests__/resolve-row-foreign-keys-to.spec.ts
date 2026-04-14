import { QueryBus } from '@nestjs/cqrs';
import {
  createPreviousFile,
  prepareBranch,
  prepareRow,
  prepareTableWithSchema,
} from 'src/__tests__/utils/prepareProject';
import {
  getObjectSchema,
  getRefSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import type { QueryTestKit } from 'src/__tests__/kit/create-query-test-kit';
import { createQueryTestKit } from 'src/__tests__/kit/create-query-test-kit';
import { FileStatus } from 'src/features/plugin/file/consts';
import {
  ResolveRowForeignKeysToQuery,
  ResolveRowForeignKeysToReturnType,
} from 'src/features/row/queries/impl';
import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

describe('ResolveRowForeignKeysToHandler', () => {
  it('should compute rows', async () => {
    const {
      headRevisionId,
      draftRevisionId,
      schemaTableVersionId,
      migrationTableVersionId,
    } = await prepareBranch(prismaService);

    const toTable = await prepareTableWithSchema({
      prismaService,
      headRevisionId,
      draftRevisionId,
      schemaTableVersionId,
      migrationTableVersionId,
      schema: getObjectSchema({
        file: getRefSchema(SystemSchemaIds.File),
        title: getStringSchema(),
      }),
    });

    const table = await prepareTableWithSchema({
      prismaService,
      headRevisionId,
      draftRevisionId,
      schemaTableVersionId,
      migrationTableVersionId,
      schema: getObjectSchema({
        link: getStringSchema({
          foreignKey: toTable.tableId,
        }),
      }),
    });

    const toData = {
      file: {
        ...createPreviousFile(),
        status: FileStatus.uploaded,
        url: '',
      },
      title: 'title',
    };

    const toRow = await prepareRow({
      prismaService,
      headTableVersionId: toTable.headTableVersionId,
      draftTableVersionId: toTable.draftTableVersionId,
      schema: toTable.schema,
      data: toData,
      dataDraft: toData,
    });

    const data = {
      link: toRow.rowId,
    };

    const row = await prepareRow({
      prismaService,
      headTableVersionId: table.headTableVersionId,
      draftTableVersionId: table.draftTableVersionId,
      schema: toTable.schema,
      data: data,
      dataDraft: data,
    });

    const result = await runTransaction(
      new ResolveRowForeignKeysToQuery({
        revisionId: draftRevisionId,
        tableId: table.tableId,
        rowId: row.rowId,
        first: 100,
        foreignKeyToTableId: toTable.tableId,
      }),
    );

    expect(result.totalCount).toEqual(1);

    const resultData = (result.edges[0] as (typeof result.edges)[number]).node
      .data as typeof toData;
    expect(resultData.title).toBe('title');
    expect(resultData.file.url).toBeTruthy();
  });

  function runTransaction(
    query: ResolveRowForeignKeysToQuery,
  ): Promise<ResolveRowForeignKeysToReturnType> {
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
