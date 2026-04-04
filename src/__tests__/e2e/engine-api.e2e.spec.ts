import { Test } from '@nestjs/testing';
import {
  getNumberSchema,
  getObjectSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import { EngineApiService } from 'src/engine-api.service';
import { AppModule } from 'src/app.module';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { STORAGE_SERVICE } from 'src/infrastructure/storage/storage.interface';
import { prepareProject } from 'src/__tests__/utils/prepareProject';

const mockStorage = {
  isAvailable: true,
  canServeFiles: false,
  uploadFile: jest.fn().mockResolvedValue({ key: 'uploads/fake.png' }),
  getPublicUrl: jest.fn((key: string) => `http://test-files/${key}`),
};

describe('EngineApi E2E', () => {
  let api: EngineApiService;
  let prisma: PrismaService;

  let projectId: string;
  let branchId: string;
  let branchName: string;
  let draftRevisionId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(STORAGE_SERVICE)
      .useValue(mockStorage)
      .compile();

    await module.init();

    api = module.get(EngineApiService);
    prisma = module.get(PrismaService);

    const project = await prepareProject(prisma);
    projectId = project.projectId;
    branchId = project.branchId;
    branchName = project.branchName;
    draftRevisionId = project.draftRevisionId;
  });

  const testSchema = getObjectSchema({
    name: getStringSchema(),
    price: getNumberSchema(),
  });

  async function refreshDraftRevisionId() {
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      include: {
        revisions: { where: { isDraft: true } },
      },
    });
    const revisions = branch?.revisions ?? [];
    const draftRevision = revisions[0];
    if (draftRevision) {
      draftRevisionId = draftRevision.id;
    }
  }

  describe('full lifecycle', () => {
    it('should create a table', async () => {
      const result = await api.createTable({
        revisionId: draftRevisionId,
        tableId: 'products',
        schema: testSchema,
      });

      expect(result.table?.id).toBe('products');
    });

    it('should create a row', async () => {
      const result = await api.createRow({
        revisionId: draftRevisionId,
        tableId: 'products',
        rowId: 'item-1',
        data: { name: 'Widget', price: 10 },
      });

      expect(result.table?.id).toBe('products');
      expect(result.row?.id).toBe('item-1');
    });

    it('should get the row', async () => {
      const row = await api.getRow({
        revisionId: draftRevisionId,
        tableId: 'products',
        rowId: 'item-1',
      });

      expect(row).toBeDefined();
      expect((row as Record<string, unknown>).id).toBe('item-1');
    });

    it('should get rows list', async () => {
      const result = await api.getRows({
        revisionId: draftRevisionId,
        tableId: 'products',
        first: 10,
      });

      expect(result.edges.length).toBeGreaterThanOrEqual(1);
    });

    it('should update a row', async () => {
      const result = await api.updateRow({
        revisionId: draftRevisionId,
        tableId: 'products',
        rowId: 'item-1',
        data: { name: 'Super Widget', price: 20 },
      });

      expect(result.row?.id).toBe('item-1');
    });

    it('should get tables', async () => {
      const result = await api.getTables({
        revisionId: draftRevisionId,
        first: 10,
      });

      const tableIds = result.edges.map((e) => e.node.id);
      expect(tableIds).toContain('products');
    });

    it('should commit revision', async () => {
      const result = await api.createRevision({
        projectId,
        branchName,
        comment: 'Initial products',
      });

      expect(result).toBeDefined();
      await refreshDraftRevisionId();
    });

    it('should show revision changes are empty after commit', async () => {
      const changes = await api.revisionChanges({
        revisionId: draftRevisionId,
      });

      expect(changes.totalChanges).toBe(0);
    });

    it('should create another row and see changes', async () => {
      await api.createRow({
        revisionId: draftRevisionId,
        tableId: 'products',
        rowId: 'item-2',
        data: { name: 'Gadget', price: 30 },
      });

      const changes = await api.revisionChanges({
        revisionId: draftRevisionId,
      });

      expect(changes.totalChanges).toBeGreaterThan(0);
    });

    it('should revert changes', async () => {
      const result = await api.revertChanges({
        projectId,
        branchName,
      });

      expect(result).toBeDefined();
    });
  });

  describe('schema operations', () => {
    it('should rename table', async () => {
      await api.createTable({
        revisionId: draftRevisionId,
        tableId: 'temp-table',
        schema: getObjectSchema({ val: getNumberSchema() }),
      });

      const result = await api.renameTable({
        revisionId: draftRevisionId,
        tableId: 'temp-table',
        nextTableId: 'renamed-table',
      });

      expect(result.table?.id).toBe('renamed-table');
    });

    it('should remove table', async () => {
      await api.removeTable({
        revisionId: draftRevisionId,
        tableId: 'renamed-table',
      });

      const tables = await api.getTables({
        revisionId: draftRevisionId,
        first: 100,
      });

      const tableIds = tables.edges.map((e) => e.node.id);
      expect(tableIds).not.toContain('renamed-table');
    });
  });

  describe('table queries', () => {
    it('should getTable, getCountRowsInTable, and resolveTableSchema', async () => {
      const table = await api.getTable({
        revisionId: draftRevisionId,
        tableId: 'products',
      });
      expect(table).toBeDefined();
      expect(table.id).toBe('products');

      const count = await api.getCountRowsInTable({
        tableVersionId: table.versionId,
      });
      expect(count).toBeGreaterThanOrEqual(1);

      const schema = await api.resolveTableSchema({
        revisionId: draftRevisionId,
        tableId: 'products',
      });
      expect(schema).toBeDefined();
      expect('type' in schema && schema.type).toBe('object');
      expect('properties' in schema && schema.properties).toBeDefined();
    });
  });

  describe('row mutations', () => {
    it('should updateRows in batch', async () => {
      await api.createRow({
        revisionId: draftRevisionId,
        tableId: 'products',
        rowId: 'batch-1',
        data: { name: 'A', price: 1 },
      });
      await api.createRow({
        revisionId: draftRevisionId,
        tableId: 'products',
        rowId: 'batch-2',
        data: { name: 'B', price: 2 },
      });

      const result = await api.updateRows({
        revisionId: draftRevisionId,
        tableId: 'products',
        rows: [
          { rowId: 'batch-1', data: { name: 'A-updated', price: 11 } },
          { rowId: 'batch-2', data: { name: 'B-updated', price: 22 } },
        ],
      });

      expect(result.rows).toHaveLength(2);
    });

    it('should patchRow', async () => {
      const result = await api.patchRow({
        revisionId: draftRevisionId,
        tableId: 'products',
        rowId: 'batch-1',
        patches: [{ op: 'replace', path: 'name', value: 'A-patched' }],
      });

      expect(result.row?.id).toBe('batch-1');
    });

    it('should renameRow', async () => {
      const result = await api.renameRow({
        revisionId: draftRevisionId,
        tableId: 'products',
        rowId: 'batch-2',
        nextRowId: 'batch-2-renamed',
      });

      expect(result.row?.id).toBe('batch-2-renamed');
    });

    it('should removeRow', async () => {
      await api.removeRow({
        revisionId: draftRevisionId,
        tableId: 'products',
        rowId: 'batch-1',
      });

      const row = await api.getRow({
        revisionId: draftRevisionId,
        tableId: 'products',
        rowId: 'batch-1',
      });
      expect(row).toBeNull();
    });

    it('should removeRows in batch', async () => {
      await api.createRow({
        revisionId: draftRevisionId,
        tableId: 'products',
        rowId: 'del-1',
        data: { name: 'Del1', price: 1 },
      });
      await api.createRow({
        revisionId: draftRevisionId,
        tableId: 'products',
        rowId: 'del-2',
        data: { name: 'Del2', price: 2 },
      });

      await api.removeRows({
        revisionId: draftRevisionId,
        tableId: 'products',
        rowIds: ['del-1', 'del-2'],
      });

      const row1 = await api.getRow({
        revisionId: draftRevisionId,
        tableId: 'products',
        rowId: 'del-1',
      });
      const row2 = await api.getRow({
        revisionId: draftRevisionId,
        tableId: 'products',
        rowId: 'del-2',
      });
      expect(row1).toBeNull();
      expect(row2).toBeNull();
    });

    afterAll(async () => {
      // Clean up remaining test rows
      try {
        await api.removeRow({
          revisionId: draftRevisionId,
          tableId: 'products',
          rowId: 'batch-2-renamed',
        });
      } catch {
        // row may already be gone
      }
      try {
        await api.revertChanges({ projectId, branchName });
      } catch {
        // no changes to revert
      }
    });
  });

  describe('searchRows', () => {
    it('should find rows by keyword', async () => {
      await api.createRow({
        revisionId: draftRevisionId,
        tableId: 'products',
        rowId: 'search-hit',
        data: { name: 'Searchable Unique Widget', price: 99 },
      });

      const result = await api.searchRows({
        revisionId: draftRevisionId,
        query: 'Searchable Unique Widget',
        first: 10,
      });

      expect(result.totalCount).toBeGreaterThanOrEqual(1);
      const rowIds = result.edges.map((e) => e.node.row.id);
      expect(rowIds).toContain('search-hit');
    });

    afterAll(async () => {
      try {
        await api.revertChanges({ projectId, branchName });
      } catch {
        // no changes to revert
      }
    });
  });

  describe('branch queries', () => {
    it('should getBranch, getHeadRevision, getDraftRevision, getTouchedByBranchId', async () => {
      const branch = await api.getBranch({ projectId, branchName });
      expect(branch).toBeDefined();
      expect(branch.id).toBe(branchId);

      const head = await api.getHeadRevision(branchId);
      expect(head).toBeDefined();
      expect(head.isHead).toBe(true);

      const draft = await api.getDraftRevision(branchId);
      expect(draft).toBeDefined();
      expect(draft.isDraft).toBe(true);

      const touched = await api.getTouchedByBranchId(branchId);
      expect(touched).toBe(false);
    });
  });

  describe('revision queries', () => {
    it('should getRevision, getRevisionParent, getMigrations', async () => {
      const revision = await api.getRevision({
        revisionId: draftRevisionId,
      });
      expect(revision).toBeDefined();
      expect(revision.id).toBe(draftRevisionId);
      expect(revision.isDraft).toBe(true);

      const parent = await api.getRevisionParent(draftRevisionId);
      expect(parent).toBeDefined();
      expect(parent?.isHead).toBe(true);

      const migrations = await api.getMigrations({
        revisionId: draftRevisionId,
      });
      expect(Array.isArray(migrations)).toBe(true);
    });
  });

  describe('table views', () => {
    it('should getTableViews and updateTableViews', async () => {
      const views = await api.getTableViews({
        revisionId: draftRevisionId,
        tableId: 'products',
      });
      expect(views).toBeDefined();
      expect(views.views).toBeDefined();

      const updated = await api.updateTableViews({
        revisionId: draftRevisionId,
        tableId: 'products',
        viewsData: {
          version: 1,
          defaultViewId: 'default',
          views: [
            {
              id: 'default',
              name: 'Default View',
              columns: [{ field: 'data.name' }, { field: 'data.price' }],
              sorts: [{ field: 'data.name', direction: 'asc' }],
            },
          ],
        },
      });
      expect(updated).toBe(true);

      const viewsAfter = await api.getTableViews({
        revisionId: draftRevisionId,
        tableId: 'products',
      });
      const defaultView = viewsAfter.views.find((v) => v.id === 'default');
      expect(defaultView?.name).toBe('Default View');
      expect(defaultView?.sorts).toHaveLength(1);
    });

    afterAll(async () => {
      try {
        await api.revertChanges({ projectId, branchName });
      } catch {
        // no changes to revert
      }
    });
  });

  describe('cleanOrphanedData', () => {
    it('should delete orphaned tables and rows', async () => {
      // Create an orphan table (not connected to any revision)
      await prisma.table.create({
        data: {
          versionId: 'orphan-table-version',
          createdId: 'orphan-table-created',
          id: 'orphan-table',
          readonly: false,
        },
      });

      // Create an orphan row (not connected to any table)
      await prisma.row.create({
        data: {
          versionId: 'orphan-row-version',
          createdId: 'orphan-row-created',
          id: 'orphan-row',
          readonly: false,
          data: {},
          hash: 'orphan-hash',
          schemaHash: 'orphan-schema-hash',
        },
      });

      const result = await api.cleanOrphanedData();
      expect(result.tables).toBeGreaterThanOrEqual(1);
      expect(result.rows).toBeGreaterThanOrEqual(1);

      // Verify orphans are deleted
      const orphanTable = await prisma.table.findUnique({
        where: { versionId: 'orphan-table-version' },
      });
      expect(orphanTable).toBeNull();

      const orphanRow = await prisma.row.findUnique({
        where: { versionId: 'orphan-row-version' },
      });
      expect(orphanRow).toBeNull();
    });
  });
});
