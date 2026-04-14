import { GetTableViewsHandler } from 'src/features/views/queries/handlers/get-table-views.handler';
import { GetTableViewsQuery } from 'src/features/views/queries/impl';
import {
  DEFAULT_VIEW_ID,
  TableViewsData,
  View,
  ViewFilterGroup,
} from 'src/features/views/types';
import {
  createViewsQueryTestKit,
  createViewsRow,
  givenSeparateViewsTables,
  givenSharedViewsTable,
  givenViewsQueryTable,
  type ViewsQueryTestKit,
} from './views-query.spec-helper';

const DEFAULT_VIEWS_DATA: TableViewsData = {
  version: 1,
  defaultViewId: DEFAULT_VIEW_ID,
  views: [
    {
      id: DEFAULT_VIEW_ID,
      name: 'Default',
      columns: null,
      sorts: [],
      search: '',
    },
  ],
};

describe('GetTableViewsHandler', () => {
  describe('when views table does not exist', () => {
    it('should return default views data', async () => {
      const { draftRevisionId, tableId } = await givenViewsQueryTable(kit);

      const result = await handler.execute(
        new GetTableViewsQuery({
          revisionId: draftRevisionId,
          tableId,
        }),
      );

      expect(result).toEqual(DEFAULT_VIEWS_DATA);
      expect(result.version).toBe(1);
      expect(result.defaultViewId).toBe(DEFAULT_VIEW_ID);
      expect(result.views).toHaveLength(1);
      expect((result.views[0] as View).id).toBe(DEFAULT_VIEW_ID);
      expect((result.views[0] as View).name).toBe('Default');
    });
  });

  describe('when views table exists but no row for table', () => {
    it('should return default views data', async () => {
      const { draftRevisionId, tableId } = await givenSharedViewsTable({
        kit,
        scenario: await givenViewsQueryTable(kit),
      });

      const result = await handler.execute(
        new GetTableViewsQuery({
          revisionId: draftRevisionId,
          tableId,
        }),
      );

      expect(result).toEqual(DEFAULT_VIEWS_DATA);
    });

    it('should return default views even if other tables have views configured', async () => {
      const scenario = await givenSharedViewsTable({
        kit,
        scenario: await givenViewsQueryTable(kit),
      });

      const otherTableId = `other-table-${Date.now()}`;
      await createViewsRow({
        kit,
        viewsTableVersionId: scenario.viewsTableVersionId,
        tableId: otherTableId,
        data: {
          version: 1,
          defaultViewId: 'custom',
          views: [
            {
              id: 'custom',
              name: 'Custom View',
            },
          ],
        },
      });

      const result = await handler.execute(
        new GetTableViewsQuery({
          revisionId: scenario.draftRevisionId,
          tableId: scenario.tableId,
        }),
      );

      expect(result).toEqual(DEFAULT_VIEWS_DATA);
    });
  });

  describe('when views table and row exist', () => {
    it('should return stored views data', async () => {
      const scenario = await givenSharedViewsTable({
        kit,
        scenario: await givenViewsQueryTable(kit),
      });

      const customViewsData: TableViewsData = {
        version: 1,
        defaultViewId: 'published',
        views: [
          {
            id: 'default',
            name: 'Default',
            columns: [
              { field: 'id', width: 150 },
              { field: 'data.title', width: 300 },
            ],
            sorts: [{ field: 'id', direction: 'asc' }],
            search: '',
          },
          {
            id: 'published',
            name: 'Published Only',
            description: 'Shows only published posts',
            columns: [
              { field: 'id', width: 150 },
              { field: 'data.title', width: 400 },
              { field: 'data.publishedAt', width: 150 },
            ],
            filters: {
              logic: 'and',
              conditions: [
                {
                  field: 'data.status',
                  operator: 'equals',
                  value: 'published',
                },
              ],
            },
            sorts: [{ field: 'data.publishedAt', direction: 'desc' }],
            search: '',
          },
        ],
      };

      await createViewsRow({
        kit,
        viewsTableVersionId: scenario.viewsTableVersionId,
        tableId: scenario.tableId,
        data: customViewsData,
      });

      const result = await handler.execute(
        new GetTableViewsQuery({
          revisionId: scenario.draftRevisionId,
          tableId: scenario.tableId,
        }),
      );

      expect(result).toEqual(customViewsData);
      expect(result.version).toBe(1);
      expect(result.defaultViewId).toBe('published');
      expect(result.views).toHaveLength(2);
    });

    it('should return views with filters containing nested groups', async () => {
      const scenario = await givenSharedViewsTable({
        kit,
        scenario: await givenViewsQueryTable(kit),
      });

      const viewsWithNestedFilters: TableViewsData = {
        version: 1,
        defaultViewId: 'complex',
        views: [
          {
            id: 'complex',
            name: 'Complex Filter',
            filters: {
              logic: 'and',
              conditions: [
                { field: 'data.status', operator: 'equals', value: 'active' },
              ],
              groups: [
                {
                  logic: 'or',
                  conditions: [
                    { field: 'data.type', operator: 'equals', value: 'post' },
                    {
                      field: 'data.type',
                      operator: 'equals',
                      value: 'article',
                    },
                  ],
                },
              ],
            },
          },
        ],
      };

      await createViewsRow({
        kit,
        viewsTableVersionId: scenario.viewsTableVersionId,
        tableId: scenario.tableId,
        data: viewsWithNestedFilters,
      });

      const result = await handler.execute(
        new GetTableViewsQuery({
          revisionId: scenario.draftRevisionId,
          tableId: scenario.tableId,
        }),
      );

      expect(result).toEqual(viewsWithNestedFilters);
      const view0 = result.views[0] as View;
      expect(view0.filters?.groups).toHaveLength(1);
      expect(
        (view0.filters?.groups?.[0] as ViewFilterGroup).conditions,
      ).toHaveLength(2);
    });
  });

  describe('head vs draft revision', () => {
    it('should return views from specific revision', async () => {
      const scenario = await givenSeparateViewsTables({
        kit,
        scenario: await givenViewsQueryTable(kit),
      });

      const headViewsData: TableViewsData = {
        version: 1,
        defaultViewId: 'head-view',
        views: [{ id: 'head-view', name: 'Head View' }],
      };

      const draftViewsData: TableViewsData = {
        version: 1,
        defaultViewId: 'draft-view',
        views: [{ id: 'draft-view', name: 'Draft View' }],
      };

      await createViewsRow({
        kit,
        viewsTableVersionId: scenario.headViewsTableVersionId,
        tableId: scenario.tableId,
        data: headViewsData,
      });
      await createViewsRow({
        kit,
        viewsTableVersionId: scenario.draftViewsTableVersionId,
        tableId: scenario.tableId,
        data: draftViewsData,
      });

      const headResult = await handler.execute(
        new GetTableViewsQuery({
          revisionId: scenario.headRevisionId,
          tableId: scenario.tableId,
        }),
      );

      const draftResult = await handler.execute(
        new GetTableViewsQuery({
          revisionId: scenario.draftRevisionId,
          tableId: scenario.tableId,
        }),
      );

      expect(headResult.defaultViewId).toBe('head-view');
      expect(draftResult.defaultViewId).toBe('draft-view');
    });
  });

  let kit: ViewsQueryTestKit;
  let handler: GetTableViewsHandler;

  beforeAll(async () => {
    kit = await createViewsQueryTestKit();
    handler = kit.module.get(GetTableViewsHandler);
  });

  afterAll(async () => {
    await kit.close();
  });
});
