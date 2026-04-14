import { QueryBus } from '@nestjs/cqrs';
import {
  getObjectSchema,
  getNumberSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import type { QueryTestKit } from 'src/__tests__/kit/create-query-test-kit';
import { createQueryTestKit } from 'src/__tests__/kit/create-query-test-kit';
import {
  SearchRowsQuery,
  SearchRowsResponse,
} from 'src/features/row/queries/impl';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import {
  createSearchRow,
  createSearchTable,
  givenSearchRowsProject,
  updateSearchRow,
  updateSearchSchema,
} from './row-query.spec-helper';

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
  const runTransaction = async <T>(query: SearchRowsQuery): Promise<T> => {
    return transactionService.run(async () => {
      return queryBus.execute(query);
    });
  };

  describe('basic search functionality', () => {
    it('should find rows with matching content', async () => {
      const {
        draftRevisionId,
        draftRowVersionId,
        tableId,
        schemaRowVersionId,
      } = await givenSearchRowsProject(kit);
      const newData = {
        ver: 123,
        title: 'Hello World',
        description: 'Test document',
      };
      await updateSearchSchema({
        kit,
        schemaRowVersionId,
        schema: searchTestSchema,
      });
      await updateSearchRow({
        kit,
        rowVersionId: draftRowVersionId,
        data: newData,
        schema: searchTestSchema,
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
      const { draftRevisionId, draftRowVersionId, schemaRowVersionId } =
        await givenSearchRowsProject(kit);
      const newData = { ver: 456, content: 'UPPERCASE TEXT' };
      await updateSearchSchema({
        kit,
        schemaRowVersionId,
        schema: searchTestSchema,
      });
      await updateSearchRow({
        kit,
        rowVersionId: draftRowVersionId,
        data: newData,
        schema: searchTestSchema,
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
      const { draftRevisionId, draftRowVersionId, schemaRowVersionId } =
        await givenSearchRowsProject(kit);
      const newData = { ver: 789, title: 'Test Document' };
      await updateSearchSchema({
        kit,
        schemaRowVersionId,
        schema: searchTestSchema,
      });
      await updateSearchRow({
        kit,
        rowVersionId: draftRowVersionId,
        data: newData,
        schema: searchTestSchema,
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
        headRevisionId,
        draftRevisionId,
        draftRowVersionId,
        tableId,
        schemaTableVersionId,
        migrationTableVersionId,
        schemaRowVersionId,
      } = await givenSearchRowsProject(kit);
      await updateSearchSchema({
        kit,
        schemaRowVersionId,
        schema: searchTestSchema,
      });

      const data1 = { ver: 1, name: 'Product Apple', category: 'Fruits' };
      await updateSearchRow({
        kit,
        rowVersionId: draftRowVersionId,
        data: data1,
        schema: searchTestSchema,
      });

      const secondTable = await createSearchTable({
        kit,
        headRevisionId,
        draftRevisionId,
        schemaTableVersionId,
        migrationTableVersionId,
        schema: searchTestSchema,
      });

      await createSearchRow({
        kit,
        tableVersionId: secondTable.draftTableVersionId,
        data: { ver: 2, brand: 'Apple Inc', type: 'Technology' },
      });

      const result = await runTransaction<SearchRowsResponse>(
        new SearchRowsQuery({
          revisionId: draftRevisionId,
          query: 'Apple',
          first: 10,
        }),
      );

      expect(result.totalCount).toBe(2);
      expect(result.edges).toHaveLength(2);

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
        schemaRowVersionId,
      } = await givenSearchRowsProject(kit);
      await updateSearchSchema({
        kit,
        schemaRowVersionId,
        schema: searchTestSchema,
      });

      const headData = {
        ver: 1,
        content: 'Head revision content with keyword',
      };
      await updateSearchRow({
        kit,
        rowVersionId: headRowVersionId,
        data: headData,
        schema: searchTestSchema,
      });

      const draftData = {
        ver: 2,
        content: 'Draft revision content with keyword',
      };
      await updateSearchRow({
        kit,
        rowVersionId: draftRowVersionId,
        data: draftData,
        schema: searchTestSchema,
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
      const { draftRevisionId, draftTableVersionId, schemaRowVersionId } =
        await givenSearchRowsProject(kit);
      await updateSearchSchema({
        kit,
        schemaRowVersionId,
        schema: searchTestSchema,
      });
      await createSearchRow({
        kit,
        tableVersionId: draftTableVersionId,
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
      const { draftRevisionId, draftTableVersionId, schemaRowVersionId } =
        await givenSearchRowsProject(kit);
      await updateSearchSchema({
        kit,
        schemaRowVersionId,
        schema: searchTestSchema,
      });

      for (let i = 1; i <= 5; i++) {
        await createSearchRow({
          kit,
          tableVersionId: draftTableVersionId,
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
      const { draftRevisionId, draftTableVersionId, schemaRowVersionId } =
        await givenSearchRowsProject(kit);
      await updateSearchSchema({
        kit,
        schemaRowVersionId,
        schema: searchTestSchema,
      });
      await createSearchRow({
        kit,
        tableVersionId: draftTableVersionId,
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
      const { draftRevisionId, draftTableVersionId, schemaRowVersionId } =
        await givenSearchRowsProject(kit);
      await updateSearchSchema({
        kit,
        schemaRowVersionId,
        schema: searchTestSchema,
      });
      await createSearchRow({
        kit,
        tableVersionId: draftTableVersionId,
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

  let kit: QueryTestKit;
  let queryBus: QueryBus;
  let transactionService: TransactionPrismaService;

  beforeAll(async () => {
    kit = await createQueryTestKit();
    queryBus = kit.queryBus;
    transactionService = kit.transactionService;
  });

  afterAll(async () => {
    await kit.close();
  });
});
