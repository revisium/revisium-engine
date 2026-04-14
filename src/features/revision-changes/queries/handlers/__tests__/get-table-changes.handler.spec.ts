import { GetTableChangesHandler } from '../get-table-changes.handler';
import { GetTableChangesQuery } from '../../impl/get-table-changes.query';
import { DiffService } from 'src/features/share/diff.service';
import { SchemaImpactService } from '../../../services/schema-impact.service';
import { RevisionComparisonService } from '../../../services/revision-comparison.service';
import { ViewsComparisonService } from '../../../services/views-comparison.service';
import { TableChangeMapper } from '../../../mappers/table-change.mapper';
import { ChangeType, MigrationType, ViewChange } from '../../../types';
import { createRevisionChangesTestKit } from 'src/features/revision-changes/__tests__/revision-changes-test-kit';
import {
  createMultipleRevisions,
  createMultipleTableChangesScenario,
  createRenamedTableScenario,
  createRevisionWithoutParent,
  createTableChangesScenario,
  createTableWithMigrationScenario,
  createTableWithModifiedViewsScenario,
  createTableWithRemovedViewsScenario,
  createTableWithRowsScenario,
  createTableWithViewsScenario,
  createTablesWithSystemScenario,
} from 'src/features/revision-changes/__tests__/revision-changes.fixtures';

describe('GetTableChangesHandler', () => {
  describe('execute', () => {
    it('returns empty result for revision without parent', async () => {
      const { revision } = await createRevisionWithoutParent(kit.prismaService);

      const result = await handler.execute(
        new GetTableChangesQuery({
          revisionId: revision.id,
          first: 10,
        }),
      );

      expect(result.edges).toEqual([]);
      expect(result.totalCount).toBe(0);
      expect(result.pageInfo.hasNextPage).toBe(false);
      expect(result.pageInfo.hasPreviousPage).toBe(false);
    });

    it('returns table changes with correct change types', async () => {
      const { toRevision, addedTable } = await createTableChangesScenario(
        kit.prismaService,
      );

      const result = await handler.execute(
        new GetTableChangesQuery({
          revisionId: toRevision.id,
          first: 10,
        }),
      );

      expect(result.edges.length).toBeGreaterThan(0);
      expect(result.totalCount).toBeGreaterThan(0);

      const addedChange = result.edges.find(
        (edge) => edge.node.tableCreatedId === addedTable.createdId,
      );
      expect(addedChange?.node.changeType).toBe(ChangeType.Added);
    });

    it('handles pagination correctly', async () => {
      const { toRevision } = await createMultipleTableChangesScenario(
        kit.prismaService,
      );

      const page1 = await handler.execute(
        new GetTableChangesQuery({
          revisionId: toRevision.id,
          first: 2,
        }),
      );

      expect(page1.edges.length).toBe(2);
      expect(page1.pageInfo.hasNextPage).toBe(true);

      const lastEdge = page1.edges.at(-1);
      expect(lastEdge).toBeDefined();

      const page2 = await handler.execute(
        new GetTableChangesQuery({
          revisionId: toRevision.id,
          first: 2,
          after: lastEdge?.cursor,
        }),
      );

      expect(page2.edges.length).toBeGreaterThan(0);
    });

    it('excludes system tables by default', async () => {
      const { toRevision } = await createTablesWithSystemScenario(
        kit.prismaService,
      );

      const result = await handler.execute(
        new GetTableChangesQuery({
          revisionId: toRevision.id,
          first: 10,
        }),
      );

      expect(result.totalCount).toBe(1);
    });

    it('includes system tables when includeSystem is true', async () => {
      const { toRevision } = await createTablesWithSystemScenario(
        kit.prismaService,
      );

      const result = await handler.execute(
        new GetTableChangesQuery({
          revisionId: toRevision.id,
          first: 10,
          filters: {
            includeSystem: true,
          },
        }),
      );

      expect(result.totalCount).toBe(2);
    });

    it('handles renamed and modified table correctly', async () => {
      const { toRevision, fromTable, toTable } =
        await createRenamedTableScenario(kit.prismaService);

      const result = await handler.execute(
        new GetTableChangesQuery({
          revisionId: toRevision.id,
          first: 10,
        }),
      );

      expect(result.edges.length).toBe(1);
      const change = result.edges[0]?.node;
      expect(change?.changeType).toBe(ChangeType.RenamedAndModified);
      expect(change?.oldTableId).toBe(fromTable.id);
      expect(change?.newTableId).toBe(toTable.id);
    });

    it('compares with specified revision', async () => {
      const { revision1, revision3 } = await createMultipleRevisions(
        kit.prismaService,
      );

      const result = await handler.execute(
        new GetTableChangesQuery({
          revisionId: revision3.id,
          compareWithRevisionId: revision1.id,
          first: 10,
        }),
      );

      expect(result).toBeDefined();
    });

    it('includes row counts for each table', async () => {
      const { toRevision } = await createTableWithRowsScenario(
        kit.prismaService,
      );

      const result = await handler.execute(
        new GetTableChangesQuery({
          revisionId: toRevision.id,
          first: 10,
        }),
      );

      const tableChange = result.edges[0]?.node;
      expect(tableChange?.rowChangesCount).toBeDefined();
      expect(tableChange?.addedRowsCount).toBeDefined();
    });

    it('filters by changeTypes', async () => {
      const { toRevision, addedTable } = await createTableChangesScenario(
        kit.prismaService,
      );

      const result = await handler.execute(
        new GetTableChangesQuery({
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

      const addedChange = result.edges.find(
        (edge) => edge.node.tableCreatedId === addedTable.createdId,
      );
      expect(addedChange).toBeDefined();
    });

    it('filters by multiple changeTypes', async () => {
      const { toRevision } = await createTableChangesScenario(
        kit.prismaService,
      );

      const result = await handler.execute(
        new GetTableChangesQuery({
          revisionId: toRevision.id,
          first: 10,
          filters: {
            changeTypes: [ChangeType.Added, ChangeType.Modified],
          },
        }),
      );

      result.edges.forEach((edge) => {
        expect([ChangeType.Added, ChangeType.Modified]).toContain(
          edge.node.changeType,
        );
      });
      expect(result.edges.length).toBeGreaterThan(0);
    });

    it('returns schemaMigrations for tables with migrations', async () => {
      const { toRevision, addedTable } = await createTableWithMigrationScenario(
        kit.prismaService,
      );

      const result = await handler.execute(
        new GetTableChangesQuery({
          revisionId: toRevision.id,
          first: 10,
        }),
      );

      const tableChange = result.edges.find(
        (edge) => edge.node.tableCreatedId === addedTable.createdId,
      );
      expect(tableChange?.node.schemaMigrations).toHaveLength(1);
      expect(tableChange?.node.schemaMigrations[0]).toMatchObject({
        migrationType: MigrationType.Init,
      });
    });

    it('returns viewsChanges with no changes when no views exist', async () => {
      const { toRevision, addedTable } = await createTableChangesScenario(
        kit.prismaService,
      );

      const result = await handler.execute(
        new GetTableChangesQuery({
          revisionId: toRevision.id,
          first: 10,
        }),
      );

      const tableChange = result.edges.find(
        (edge) => edge.node.tableCreatedId === addedTable.createdId,
      );

      expect(tableChange?.node.viewsChanges).toBeDefined();
      expect(tableChange?.node.viewsChanges.hasChanges).toBe(false);
      expect(tableChange?.node.viewsChanges.changes).toEqual([]);
      expect(tableChange?.node.viewsChanges.addedCount).toBe(0);
      expect(tableChange?.node.viewsChanges.modifiedCount).toBe(0);
      expect(tableChange?.node.viewsChanges.removedCount).toBe(0);
      expect(tableChange?.node.viewsChanges.renamedCount).toBe(0);
    });

    it('returns viewsChanges with added views', async () => {
      const { toRevision, addedTable } = await createTableWithViewsScenario(
        kit.prismaService,
      );

      const result = await handler.execute(
        new GetTableChangesQuery({
          revisionId: toRevision.id,
          first: 10,
        }),
      );

      const tableChange = result.edges.find(
        (edge) => edge.node.tableCreatedId === addedTable.createdId,
      );
      const viewChanges = tableChange?.node.viewsChanges.changes as
        | ViewChange[]
        | undefined;

      expect(tableChange?.node.viewsChanges.hasChanges).toBe(true);
      expect(viewChanges).toHaveLength(2);
      expect(tableChange?.node.viewsChanges.addedCount).toBe(2);
      expect(viewChanges?.[0]?.viewId).toBe('default');
      expect(viewChanges?.[0]?.changeType).toBe(ChangeType.Added);
      expect(viewChanges?.[1]?.viewId).toBe('custom');
      expect(viewChanges?.[1]?.changeType).toBe(ChangeType.Added);
    });

    it('returns viewsChanges with modified views', async () => {
      const { toRevision, modifiedTable } =
        await createTableWithModifiedViewsScenario(kit.prismaService);

      const result = await handler.execute(
        new GetTableChangesQuery({
          revisionId: toRevision.id,
          first: 10,
        }),
      );

      const tableChange = result.edges.find(
        (edge) => edge.node.tableCreatedId === modifiedTable.createdId,
      );
      const modifiedChanges = tableChange?.node.viewsChanges.changes as
        | ViewChange[]
        | undefined;

      expect(tableChange?.node.viewsChanges.hasChanges).toBe(true);
      expect(tableChange?.node.viewsChanges.modifiedCount).toBe(1);
      expect(modifiedChanges?.[0]?.viewId).toBe('default');
      expect(modifiedChanges?.[0]?.changeType).toBe(ChangeType.Modified);
    });

    it('returns viewsChanges with removed views', async () => {
      const { toRevision, modifiedTable } =
        await createTableWithRemovedViewsScenario(kit.prismaService);

      const result = await handler.execute(
        new GetTableChangesQuery({
          revisionId: toRevision.id,
          first: 10,
        }),
      );

      const tableChange = result.edges.find(
        (edge) => edge.node.tableCreatedId === modifiedTable.createdId,
      );
      const removedChanges = tableChange?.node.viewsChanges.changes as
        | ViewChange[]
        | undefined;

      expect(tableChange?.node.viewsChanges.hasChanges).toBe(true);
      expect(tableChange?.node.viewsChanges.removedCount).toBe(1);
      expect(removedChanges?.[0]?.viewId).toBe('custom');
      expect(removedChanges?.[0]?.changeType).toBe(ChangeType.Removed);
    });
  });

  let kit: Awaited<ReturnType<typeof createRevisionChangesTestKit>>;
  let handler: GetTableChangesHandler;

  beforeAll(async () => {
    kit = await createRevisionChangesTestKit({
      providers: [
        GetTableChangesHandler,
        DiffService,
        SchemaImpactService,
        RevisionComparisonService,
        ViewsComparisonService,
        TableChangeMapper,
      ],
    });
    handler = kit.module.get(GetTableChangesHandler);
  });

  afterAll(async () => {
    await kit.close();
  });
});
