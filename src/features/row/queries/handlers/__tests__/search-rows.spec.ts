import { QueryBus } from '@nestjs/cqrs';
import { nanoid } from 'nanoid';
import hash from 'object-hash';
import {
  getObjectSchema,
  getStringSchema,
  getNumberSchema,
} from '@revisium/schema-toolkit/mocks';
import {
  prepareProject,
  prepareTableWithSchema,
  prepareRow,
} from 'src/__tests__/utils/prepareProject';
import type { QueryTestKit } from 'src/__tests__/kit/create-query-test-kit';
import { createQueryTestKit } from 'src/__tests__/kit/create-query-test-kit';
import { givenDraftProjectWithSchema } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import {
  SearchRowsQuery,
  SearchRowsResponse,
} from 'src/features/row/queries/impl';
import { metaSchema } from 'src/features/share/schema/meta-schema';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

const searchTestSchema = getObjectSchema({
  ver: getNumberSchema(),
  title: getStringSchema(),
  description: getStringSchema(),
  content: getStringSchema(),
  name: getStringSchema(),
  category: getStringSchema(),
  brand: getStringSchema(),
  type: getStringSchema(),
  order: getNumberSchema(),
});

describe('SearchRowsHandler', () => {
  let kit: QueryTestKit;
  let prismaService: PrismaService;
  let queryBus: QueryBus;
  let transactionService: TransactionPrismaService;

  const runTransaction = async <T>(query: SearchRowsQuery): Promise<T> => {
    return transactionService.run(async () => {
      return queryBus.execute(query);
    });
  };

  beforeAll(async () => {
    kit = await createQueryTestKit();
    prismaService = kit.prismaService;
    queryBus = kit.queryBus;
    transactionService = kit.transactionService;
  });

  afterAll(async () => {
    await kit.close();
  });

  const updateSchemaForTest = async (schemaRowVersionId: string) => {
    await prismaService.row.update({
      where: { versionId: schemaRowVersionId },
      data: {
        data: searchTestSchema,
        hash: hash(searchTestSchema),
        schemaHash: hash(metaSchema),
      },
    });
  };

  describe('basic search functionality', () => {
    it('should find rows with matching content', async () => {
      const { draftRevisionId, draftRowVersionId, tableId } =
        await givenDraftProjectWithSchema({
          prismaService,
          schema: searchTestSchema,
        });

      const newData = {
        ver: 123,
        title: 'Hello World',
        description: 'Test document',
      };
      await prismaService.row.update({
        where: { versionId: draftRowVersionId },
        data: {
          data: newData,
          hash: hash(newData),
          schemaHash: hash(searchTestSchema),
        },
      });

      const result = await runTransaction<SearchRowsResponse>(
        new SearchRowsQuery({
          revisionId: draftRevisionId,
          query: 'Hello',
          first: 10,
        }),
      );

      expect(result.totalCount).toBe(1);
      expect(result.edges).toHaveLength(1);
      const edge0 = result.edges[0] as (typeof result.edges)[number];
      expect(edge0.node.matches).toBeDefined();
      expect(edge0.node.matches.length).toBeGreaterThan(0);
      expect(edge0.node.table.id).toBe(tableId);
    });

    it('should find rows with case-insensitive search', async () => {
      const { draftRevisionId, draftRowVersionId } =
        await givenDraftProjectWithSchema({
          prismaService,
          schema: searchTestSchema,
        });

      const newData = { ver: 456, content: 'UPPERCASE TEXT' };
      await prismaService.row.update({
        where: { versionId: draftRowVersionId },
        data: {
          data: newData,
          hash: hash(newData),
          schemaHash: hash(searchTestSchema),
        },
      });

      const result = await runTransaction<SearchRowsResponse>(
        new SearchRowsQuery({
          revisionId: draftRevisionId,
          query: 'uppercase',
          first: 10,
        }),
      );

      expect(result.totalCount).toBe(1);
      expect(result.edges).toHaveLength(1);
    });

    it('should return empty result for non-matching query', async () => {
      const { draftRevisionId, draftRowVersionId } =
        await givenDraftProjectWithSchema({
          prismaService,
          schema: searchTestSchema,
        });

      const newData = { ver: 789, title: 'Test Document' };
      await prismaService.row.update({
        where: { versionId: draftRowVersionId },
        data: {
          data: newData,
          hash: hash(newData),
          schemaHash: hash(searchTestSchema),
        },
      });

      const result = await runTransaction<SearchRowsResponse>(
        new SearchRowsQuery({
          revisionId: draftRevisionId,
          query: 'nonexistent',
          first: 10,
        }),
      );

      expect(result.totalCount).toBe(0);
      expect(result.edges).toHaveLength(0);
    });
  });

  describe('search across multiple tables', () => {
    it('should find rows from different tables in the same revision', async () => {
      const {
        draftRevisionId,
        draftRowVersionId,
        tableId,
        schemaTableVersionId,
        migrationTableVersionId,
        schemaRowVersionId,
      } = await prepareProject(prismaService);

      await updateSchemaForTest(schemaRowVersionId);

      const data1 = { ver: 1, name: 'Product Apple', category: 'Fruits' };
      await prismaService.row.update({
        where: { versionId: draftRowVersionId },
        data: {
          data: data1,
          hash: hash(data1),
          schemaHash: hash(searchTestSchema),
        },
      });

      const secondTable = await prepareTableWithSchema({
        prismaService,
        headRevisionId: draftRevisionId,
        draftRevisionId,
        schemaTableVersionId,
        migrationTableVersionId,
        schema: searchTestSchema,
      });

      await prepareRow({
        prismaService,
        headTableVersionId: secondTable.draftTableVersionId,
        draftTableVersionId: secondTable.draftTableVersionId,
        data: { ver: 2, brand: 'Apple Inc', type: 'Technology' },
        dataDraft: { ver: 2, brand: 'Apple Inc', type: 'Technology' },
        schema: searchTestSchema,
      });

      const result = await runTransaction<SearchRowsResponse>(
        new SearchRowsQuery({
          revisionId: draftRevisionId,
          query: 'Apple',
          first: 10,
        }),
      );

      expect(result.totalCount).toBe(3);
      expect(result.edges).toHaveLength(3);

      const tableIds = result.edges.map((edge) => edge.node.table.id);
      expect(tableIds).toContain(tableId);
      expect(tableIds).toContain(secondTable.tableId);
    });
  });

  describe('revision isolation', () => {
    it('should not mix results from different revisions', async () => {
      const {
        headRevisionId,
        draftRevisionId,
        headRowVersionId,
        draftRowVersionId,
      } = await givenDraftProjectWithSchema({
        prismaService,
        schema: searchTestSchema,
      });

      const headData = {
        ver: 1,
        content: 'Head revision content with keyword',
      };
      await prismaService.row.update({
        where: { versionId: headRowVersionId },
        data: {
          data: headData,
          hash: hash(headData),
          schemaHash: hash(searchTestSchema),
        },
      });

      const draftData = {
        ver: 2,
        content: 'Draft revision content with keyword',
      };
      await prismaService.row.update({
        where: { versionId: draftRowVersionId },
        data: {
          data: draftData,
          hash: hash(draftData),
          schemaHash: hash(searchTestSchema),
        },
      });

      const headResult = await runTransaction<SearchRowsResponse>(
        new SearchRowsQuery({
          revisionId: headRevisionId,
          query: 'keyword',
          first: 10,
        }),
      );

      const draftResult = await runTransaction<SearchRowsResponse>(
        new SearchRowsQuery({
          revisionId: draftRevisionId,
          query: 'keyword',
          first: 10,
        }),
      );

      expect(headResult.totalCount).toBe(1);
      expect(draftResult.totalCount).toBe(1);

      const headEdge0 = headResult
        .edges[0] as (typeof headResult.edges)[number];
      const headContent = (headEdge0.node.row.data as Record<string, unknown>)
        .content;
      const draftEdge0 = draftResult
        .edges[0] as (typeof draftResult.edges)[number];
      const draftContent = (draftEdge0.node.row.data as Record<string, unknown>)
        .content;

      expect(headContent).toContain('Head revision');
      expect(draftContent).toContain('Draft revision');
    });
  });

  describe('system tables exclusion', () => {
    it('should not search in system tables', async () => {
      const { draftRevisionId, draftTableVersionId } =
        await givenDraftProjectWithSchema({
          prismaService,
          schema: searchTestSchema,
        });

      await prismaService.row.create({
        data: {
          tables: { connect: { versionId: draftTableVersionId } },
          id: nanoid(),
          versionId: nanoid(),
          createdId: nanoid(),
          hash: '',
          schemaHash: '',
          data: {
            ver: 1,
            content: 'Regular content with searchable text',
            title: '',
            description: '',
            name: '',
            category: '',
            brand: '',
            type: '',
            order: 0,
          },
        },
      });

      const result = await runTransaction<SearchRowsResponse>(
        new SearchRowsQuery({
          revisionId: draftRevisionId,
          query: 'searchable',
          first: 10,
        }),
      );

      expect(result.totalCount).toBe(1);
      expect(result.edges).toHaveLength(1);
      const edge0 = result.edges[0] as (typeof result.edges)[number];
      expect(edge0.node.table.system).toBe(false);
    });
  });

  describe('pagination', () => {
    it('should paginate search results correctly', async () => {
      const projectData = await prepareProject(prismaService);
      const { draftRevisionId, draftTableVersionId, schemaRowVersionId } =
        projectData;

      await updateSchemaForTest(schemaRowVersionId);

      for (let i = 1; i <= 5; i++) {
        await prismaService.row.create({
          data: {
            tables: { connect: { versionId: draftTableVersionId } },
            id: nanoid(),
            versionId: nanoid(),
            createdId: nanoid(),
            hash: '',
            schemaHash: '',
            data: {
              ver: i,
              title: `Document ${i} with search term`,
              description: '',
              content: '',
              name: '',
              category: '',
              brand: '',
              type: '',
              order: i,
            },
          },
        });
      }

      const firstPage = await runTransaction<SearchRowsResponse>(
        new SearchRowsQuery({
          revisionId: draftRevisionId,
          query: 'search',
          first: 2,
        }),
      );

      expect(firstPage.totalCount).toBe(5);
      expect(firstPage.edges).toHaveLength(2);
      expect(firstPage.pageInfo.hasNextPage).toBe(true);
      expect(firstPage.pageInfo.endCursor).toBeDefined();

      const secondPage = await runTransaction<SearchRowsResponse>(
        new SearchRowsQuery({
          revisionId: draftRevisionId,
          query: 'search',
          first: 2,
          after: firstPage.pageInfo.endCursor,
        }),
      );

      expect(secondPage.edges).toHaveLength(2);
      expect(secondPage.pageInfo.hasNextPage).toBe(true);

      const thirdPage = await runTransaction<SearchRowsResponse>(
        new SearchRowsQuery({
          revisionId: draftRevisionId,
          query: 'search',
          first: 2,
          after: secondPage.pageInfo.endCursor,
        }),
      );

      expect(thirdPage.edges).toHaveLength(1);
      expect(thirdPage.pageInfo.hasNextPage).toBe(false);
    });
  });

  describe('complex data types', () => {
    it('should search in nested JSON structures', async () => {
      const projectData = await prepareProject(prismaService);
      const { draftRevisionId, draftTableVersionId, schemaRowVersionId } =
        projectData;

      await updateSchemaForTest(schemaRowVersionId);

      await prismaService.row.create({
        data: {
          tables: { connect: { versionId: draftTableVersionId } },
          id: nanoid(),
          versionId: nanoid(),
          createdId: nanoid(),
          hash: '',
          schemaHash: '',
          data: {
            ver: 1,
            title: '',
            description: 'Software developer interested in databases',
            content: '',
            name: '',
            category: '',
            brand: '',
            type: '',
            order: 0,
          },
        },
      });

      const result = await runTransaction<SearchRowsResponse>(
        new SearchRowsQuery({
          revisionId: draftRevisionId,
          query: 'databases',
          first: 10,
        }),
      );

      expect(result.totalCount).toBe(1);
      const edge0 = result.edges[0] as (typeof result.edges)[number];
      expect(edge0.node.matches).toBeDefined();
      expect(edge0.node.matches.length).toBeGreaterThan(0);
    });

    it('should search in arrays', async () => {
      const projectData = await prepareProject(prismaService);
      const { draftRevisionId, draftTableVersionId, schemaRowVersionId } =
        projectData;

      await updateSchemaForTest(schemaRowVersionId);

      await prismaService.row.create({
        data: {
          tables: { connect: { versionId: draftTableVersionId } },
          id: nanoid(),
          versionId: nanoid(),
          createdId: nanoid(),
          hash: '',
          schemaHash: '',
          data: {
            ver: 1,
            title: '',
            description: '',
            content: 'javascript typescript nodejs react',
            name: '',
            category: '',
            brand: '',
            type: '',
            order: 0,
          },
        },
      });

      const result = await runTransaction<SearchRowsResponse>(
        new SearchRowsQuery({
          revisionId: draftRevisionId,
          query: 'typescript',
          first: 10,
        }),
      );

      expect(result.totalCount).toBe(1);
      const edge0 = result.edges[0] as (typeof result.edges)[number];
      expect(edge0.node.matches).toBeDefined();
    });
  });
});
