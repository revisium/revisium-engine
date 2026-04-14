import { PluginService } from 'src/features/plugin/plugin.service';
import { GetRowChangesHandler } from '../get-row-changes.handler';
import { GetRowChangesQuery } from '../../impl/get-row-changes.query';
import { RowDiffService } from '../../../services/row-diff.service';
import { SchemaImpactService } from '../../../services/schema-impact.service';
import { RevisionComparisonService } from '../../../services/revision-comparison.service';
import { RowChangeMapper } from '../../../mappers/row-change.mapper';
import { ChangeType, getRowCreatedId, getTableCreatedId } from '../../../types';
import { createRevisionChangesTestKit } from 'src/features/revision-changes/__tests__/revision-changes-test-kit';
import {
  createModifiedRowScenario,
  createMultipleRevisions,
  createMultipleRowChangesScenario,
  createMultipleTableRowChangesScenario,
  createRenamedRowScenario,
  createRevisionWithoutParent,
  createRowChangesScenario,
  createRowsInSystemTableScenario,
  createRowsWithSearchScenario,
} from 'src/features/revision-changes/__tests__/revision-changes.fixtures';

describe('GetRowChangesHandler', () => {
  describe('execute', () => {
    it('returns empty result for revision without parent', async () => {
      const { revision } = await createRevisionWithoutParent(kit.prismaService);

      const result = await handler.execute(
        new GetRowChangesQuery({
          revisionId: revision.id,
          first: 10,
        }),
      );

      expect(result.edges).toEqual([]);
      expect(result.totalCount).toBe(0);
      expect(result.pageInfo.hasNextPage).toBe(false);
      expect(result.pageInfo.hasPreviousPage).toBe(false);
    });

    it('returns row changes with correct change types', async () => {
      const { toRevision, addedRow } = await createRowChangesScenario(
        kit.prismaService,
      );

      const result = await handler.execute(
        new GetRowChangesQuery({
          revisionId: toRevision.id,
          first: 10,
        }),
      );

      expect(result.edges.length).toBeGreaterThan(0);
      expect(result.totalCount).toBeGreaterThan(0);

      const addedChange = result.edges.find(
        (edge) => getRowCreatedId(edge.node) === addedRow.createdId,
      );
      expect(addedChange?.node.changeType).toBe(ChangeType.Added);
    });

    it('filters by tableId', async () => {
      const { toRevision, table1 } =
        await createMultipleTableRowChangesScenario(kit.prismaService);

      const result = await handler.execute(
        new GetRowChangesQuery({
          revisionId: toRevision.id,
          first: 10,
          filters: {
            tableId: table1.id,
          },
        }),
      );

      result.edges.forEach((edge) => {
        expect(getTableCreatedId(edge.node)).toBe(table1.createdId);
      });
    });

    it('searches by rowId', async () => {
      const { toRevision, searchRow } = await createRowsWithSearchScenario(
        kit.prismaService,
      );

      const result = await handler.execute(
        new GetRowChangesQuery({
          revisionId: toRevision.id,
          first: 10,
          filters: {
            search: searchRow.id.substring(0, 5),
          },
        }),
      );

      expect(result.edges.length).toBeGreaterThan(0);
      const found = result.edges.find(
        (edge) => edge.node.row?.id === searchRow.id,
      );
      expect(found).toBeDefined();
    });

    it('filters by changeTypes', async () => {
      const { toRevision } = await createRowChangesScenario(kit.prismaService);

      const result = await handler.execute(
        new GetRowChangesQuery({
          revisionId: toRevision.id,
          first: 10,
          filters: {
            changeTypes: [ChangeType.Added],
          },
        }),
      );

      result.edges.forEach((edge) => {
        expect(edge.node.changeType).toBe(ChangeType.Added);
      });
      expect(result.edges.length).toBeGreaterThan(0);
    });

    it('handles pagination correctly', async () => {
      const { toRevision } = await createMultipleRowChangesScenario(
        kit.prismaService,
      );

      const page1 = await handler.execute(
        new GetRowChangesQuery({
          revisionId: toRevision.id,
          first: 2,
        }),
      );

      expect(page1.edges.length).toBe(2);
      expect(page1.pageInfo.hasNextPage).toBe(true);

      const lastEdge = page1.edges.at(-1);
      expect(lastEdge).toBeDefined();

      const page2 = await handler.execute(
        new GetRowChangesQuery({
          revisionId: toRevision.id,
          first: 2,
          after: lastEdge?.cursor,
        }),
      );

      expect(page2.edges.length).toBeGreaterThan(0);
    });

    it('excludes system tables by default', async () => {
      const { toRevision } = await createRowsInSystemTableScenario(
        kit.prismaService,
      );

      const result = await handler.execute(
        new GetRowChangesQuery({
          revisionId: toRevision.id,
          first: 10,
        }),
      );

      expect(result.totalCount).toBe(1);
    });

    it('includes system tables when includeSystem is true', async () => {
      const { toRevision } = await createRowsInSystemTableScenario(
        kit.prismaService,
      );

      const result = await handler.execute(
        new GetRowChangesQuery({
          revisionId: toRevision.id,
          first: 10,
          filters: {
            includeSystem: true,
          },
        }),
      );

      expect(result.totalCount).toBe(2);
    });

    it('handles renamed rows correctly', async () => {
      const { toRevision, fromRow, toRow } = await createRenamedRowScenario(
        kit.prismaService,
      );

      const result = await handler.execute(
        new GetRowChangesQuery({
          revisionId: toRevision.id,
          first: 10,
        }),
      );

      expect(result.edges.length).toBe(1);
      const change = result.edges[0]?.node;
      expect(change?.changeType).toBe(ChangeType.Renamed);
      expect(change?.fromRow?.id).toBe(fromRow.id);
      expect(change?.row?.id).toBe(toRow.id);
    });

    it('includes field changes in result', async () => {
      const { toRevision } = await createModifiedRowScenario(kit.prismaService);

      const result = await handler.execute(
        new GetRowChangesQuery({
          revisionId: toRevision.id,
          first: 10,
        }),
      );

      const change = result.edges[0]?.node;
      expect(change?.fieldChanges).toBeDefined();
      expect(Array.isArray(change?.fieldChanges)).toBe(true);
    });

    it('includes table in result', async () => {
      const { toRevision, table } = await createRowChangesScenario(
        kit.prismaService,
      );

      const result = await handler.execute(
        new GetRowChangesQuery({
          revisionId: toRevision.id,
          first: 10,
        }),
      );

      const change = result.edges[0]?.node;
      expect(change).toBeDefined();
      expect(change?.table?.id).toBeDefined();
      if (!change) {
        throw new Error('Expected row change');
      }
      expect(getTableCreatedId(change)).toBe(table.createdId);
    });

    it('compares with specified revision', async () => {
      const { revision1, revision3 } = await createMultipleRevisions(
        kit.prismaService,
      );

      const result = await handler.execute(
        new GetRowChangesQuery({
          revisionId: revision3.id,
          compareWithRevisionId: revision1.id,
          first: 10,
        }),
      );

      expect(result).toBeDefined();
    });

    it('calls computeRows for each table with changes', async () => {
      const { toRevision, table } = await createRowChangesScenario(
        kit.prismaService,
      );

      await handler.execute(
        new GetRowChangesQuery({
          revisionId: toRevision.id,
          first: 10,
        }),
      );

      expect(mockPluginService.computeRows).toHaveBeenCalledWith(
        expect.objectContaining({
          revisionId: toRevision.id,
          tableId: table.id,
        }),
      );
    });

    it('calls computeRows for multiple tables when rows from different tables changed', async () => {
      const { toRevision, table1, table2 } =
        await createMultipleTableRowChangesScenario(kit.prismaService);

      await handler.execute(
        new GetRowChangesQuery({
          revisionId: toRevision.id,
          first: 10,
        }),
      );

      expect(mockPluginService.computeRows).toHaveBeenCalledTimes(2);
      expect(mockPluginService.computeRows).toHaveBeenCalledWith(
        expect.objectContaining({
          revisionId: toRevision.id,
          tableId: table1.id,
        }),
      );
      expect(mockPluginService.computeRows).toHaveBeenCalledWith(
        expect.objectContaining({
          revisionId: toRevision.id,
          tableId: table2.id,
        }),
      );
    });

    it('does not call computeRows when no row changes', async () => {
      const { revision } = await createRevisionWithoutParent(kit.prismaService);

      await handler.execute(
        new GetRowChangesQuery({
          revisionId: revision.id,
          first: 10,
        }),
      );

      expect(mockPluginService.computeRows).not.toHaveBeenCalled();
    });

    it('calls computeRows for both fromRevision and toRevision for modified rows', async () => {
      const { fromRevision, toRevision, fromTable, toTable } =
        await createModifiedRowScenario(kit.prismaService);

      await handler.execute(
        new GetRowChangesQuery({
          revisionId: toRevision.id,
          first: 10,
        }),
      );

      expect(mockPluginService.computeRows).toHaveBeenCalledWith(
        expect.objectContaining({
          revisionId: toRevision.id,
          tableId: toTable.id,
        }),
      );
      expect(mockPluginService.computeRows).toHaveBeenCalledWith(
        expect.objectContaining({
          revisionId: fromRevision.id,
          tableId: fromTable.id,
        }),
      );
    });
  });

  const mockPluginService = {
    computeRows: jest.fn().mockResolvedValue(undefined),
  };

  let kit: Awaited<ReturnType<typeof createRevisionChangesTestKit>>;
  let handler: GetRowChangesHandler;

  beforeAll(async () => {
    kit = await createRevisionChangesTestKit({
      providers: [
        GetRowChangesHandler,
        RowDiffService,
        SchemaImpactService,
        RevisionComparisonService,
        RowChangeMapper,
        {
          provide: PluginService,
          useValue: mockPluginService,
        },
      ],
    });
    handler = kit.module.get(GetRowChangesHandler);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await kit.close();
  });
});
