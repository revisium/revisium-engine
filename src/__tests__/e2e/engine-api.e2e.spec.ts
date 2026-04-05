import { Readable } from 'stream';
import { Test } from '@nestjs/testing';
import {
  getNumberSchema,
  getObjectSchema,
  getRefSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import { JsonSchemaTypeName } from '@revisium/schema-toolkit/types';
import { EngineApiService } from 'src/engine-api.service';
import { AppModule } from 'src/app.module';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { STORAGE_SERVICE } from 'src/infrastructure/storage/storage.interface';
import {
  createEmptyFile,
  prepareProject,
} from 'src/__tests__/utils/prepareProject';

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
      imports: [AppModule.forRoot()],
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
      const previousDraft = draftRevisionId;

      const result = await api.createRevision({
        projectId,
        branchName,
        comment: 'Initial products',
      });

      expect(result).toBeDefined();
      expect(result.previousDraftRevisionId).toBe(previousDraft);
      expect(typeof result.previousHeadRevisionId).toBe('string');
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

  describe('updateTable', () => {
    it('should update table schema via patches', async () => {
      await api.createTable({
        revisionId: draftRevisionId,
        tableId: 'patch-table',
        schema: getObjectSchema({ val: getNumberSchema() }),
      });

      const result = await api.updateTable({
        revisionId: draftRevisionId,
        tableId: 'patch-table',
        patches: [
          {
            op: 'add',
            path: '/properties/extra',
            value: { type: JsonSchemaTypeName.String, default: '' },
          },
        ],
      });

      expect(result.table?.id).toBe('patch-table');

      const schema = await api.resolveTableSchema({
        revisionId: draftRevisionId,
        tableId: 'patch-table',
      });
      expect('properties' in schema && schema.properties).toHaveProperty(
        'extra',
      );
    });

    afterAll(async () => {
      try {
        await api.revertChanges({ projectId, branchName });
      } catch {
        // nothing to revert
      }
    });
  });

  describe('createRows and patchRows', () => {
    it('should create multiple rows at once', async () => {
      const result = await api.createRows({
        revisionId: draftRevisionId,
        tableId: 'products',
        rows: [
          { rowId: 'bulk-1', data: { name: 'Bulk1', price: 1 } },
          { rowId: 'bulk-2', data: { name: 'Bulk2', price: 2 } },
        ],
      });

      expect(result.rows).toHaveLength(2);
    });

    it('should patch multiple rows at once', async () => {
      const result = await api.patchRows({
        revisionId: draftRevisionId,
        tableId: 'products',
        rows: [
          {
            rowId: 'bulk-1',
            patches: [{ op: 'replace', path: 'name', value: 'Bulk1-patched' }],
          },
          {
            rowId: 'bulk-2',
            patches: [{ op: 'replace', path: 'name', value: 'Bulk2-patched' }],
          },
        ],
      });

      expect(result.rows).toHaveLength(2);
    });

    afterAll(async () => {
      try {
        await api.revertChanges({ projectId, branchName });
      } catch {
        // nothing to revert
      }
    });
  });

  describe('getRowById', () => {
    it('should get a row by its versionId', async () => {
      await api.createRow({
        revisionId: draftRevisionId,
        tableId: 'products',
        rowId: 'version-lookup',
        data: { name: 'VersionLookup', price: 50 },
      });

      const row = await api.getRow({
        revisionId: draftRevisionId,
        tableId: 'products',
        rowId: 'version-lookup',
      });

      expect(row).toBeDefined();

      const rowRecord = row as Record<string, unknown>;
      const rowById = await api.getRowById({
        revisionId: draftRevisionId,
        tableId: 'products',
        rowId: 'version-lookup',
        rowVersionId: rowRecord.versionId as string,
      });

      expect(rowById).toBeDefined();
      expect((rowById as Record<string, unknown>).id).toBe('version-lookup');
    });

    afterAll(async () => {
      try {
        await api.revertChanges({ projectId, branchName });
      } catch {
        // nothing to revert
      }
    });
  });

  describe('foreign key resolution', () => {
    beforeAll(async () => {
      // Create orders table with a foreignKey field pointing to products
      const ordersSchema = getObjectSchema({
        product: getStringSchema({ foreignKey: 'products' }),
        qty: getNumberSchema(),
      });

      await api.createTable({
        revisionId: draftRevisionId,
        tableId: 'orders',
        schema: ordersSchema,
      });

      await api.createRow({
        revisionId: draftRevisionId,
        tableId: 'orders',
        rowId: 'order-1',
        data: { product: 'item-1', qty: 3 },
      });
    });

    it('should resolve table foreign keys (by and to) and counts', async () => {
      // "by" = find tables that reference 'products' via foreignKey
      const fkBy = await api.resolveTableForeignKeysBy({
        revisionId: draftRevisionId,
        tableId: 'products',
        first: 10,
      });
      expect(fkBy.edges.length).toBeGreaterThanOrEqual(1);
      const fkByIds = fkBy.edges.map((e) => e.node.id);
      expect(fkByIds).toContain('orders');

      // "to" = find tables that 'orders' points to via its foreignKey fields
      const fkTo = await api.resolveTableForeignKeysTo({
        revisionId: draftRevisionId,
        tableId: 'orders',
        first: 10,
      });
      expect(fkTo.edges.length).toBeGreaterThanOrEqual(1);
      const fkToIds = fkTo.edges.map((e) => e.node.id);
      expect(fkToIds).toContain('products');

      const countBy = await api.resolveTableCountForeignKeysBy({
        revisionId: draftRevisionId,
        tableId: 'products',
      });
      expect(countBy).toBeGreaterThanOrEqual(1);

      const countTo = await api.resolveTableCountForeignKeysTo({
        revisionId: draftRevisionId,
        tableId: 'orders',
      });
      expect(countTo).toBeGreaterThanOrEqual(1);
    });

    it('should resolve row foreign keys (by and to) and counts', async () => {
      // "by" = find rows in 'orders' that reference 'item-1' in 'products'
      const fkBy = await api.resolveRowForeignKeysBy({
        revisionId: draftRevisionId,
        tableId: 'products',
        rowId: 'item-1',
        foreignKeyByTableId: 'orders',
        first: 10,
      });
      expect(fkBy.edges.length).toBeGreaterThanOrEqual(1);

      // "to" = follow order-1's FK link to 'products'
      const fkTo = await api.resolveRowForeignKeysTo({
        revisionId: draftRevisionId,
        tableId: 'orders',
        rowId: 'order-1',
        foreignKeyToTableId: 'products',
        first: 10,
      });
      expect(fkTo.edges.length).toBeGreaterThanOrEqual(1);

      const countBy = await api.resolveRowCountForeignKeysBy({
        revisionId: draftRevisionId,
        tableId: 'products',
        rowId: 'item-1',
      });
      expect(countBy).toBeGreaterThanOrEqual(1);

      const countTo = await api.resolveRowCountForeignKeysTo({
        revisionId: draftRevisionId,
        tableId: 'orders',
        rowId: 'order-1',
      });
      expect(countTo).toBeGreaterThanOrEqual(1);
    });

    afterAll(async () => {
      try {
        await api.removeTable({
          revisionId: draftRevisionId,
          tableId: 'orders',
        });
      } catch {
        // table may already be gone
      }
      try {
        await api.revertChanges({ projectId, branchName });
      } catch {
        // nothing to revert
      }
    });
  });

  describe('applyMigrations', () => {
    it('should apply an init migration', async () => {
      // id must be an ISO date after the last migration date
      const futureDate = new Date(Date.now() + 60_000).toISOString();

      const results = await api.applyMigrations({
        revisionId: draftRevisionId,
        migrations: [
          {
            changeType: 'init',
            id: futureDate,
            tableId: 'migrated-table',
            hash: '',
            schema: getObjectSchema({ title: getStringSchema() }),
          },
        ],
      });

      expect(results).toHaveLength(1);
      expect(results.at(0)?.status).toBe('applied');

      const table = await api.getTable({
        revisionId: draftRevisionId,
        tableId: 'migrated-table',
      });
      expect(table.id).toBe('migrated-table');
    });

    afterAll(async () => {
      try {
        await api.revertChanges({ projectId, branchName });
      } catch {
        // nothing to revert
      }
    });
  });

  describe('revision chain (child / children)', () => {
    let committedRevisionId: string;

    beforeAll(async () => {
      // Make a change and commit to get a new revision
      await api.createRow({
        revisionId: draftRevisionId,
        tableId: 'products',
        rowId: 'chain-row',
        data: { name: 'Chain', price: 1 },
      });

      await api.createRevision({
        projectId,
        branchName,
        comment: 'chain test commit',
      });

      // The old draftRevisionId now became the committed head
      committedRevisionId = draftRevisionId;
      await refreshDraftRevisionId();
    });

    it('should getRevisionChild from head', async () => {
      const child = await api.getRevisionChild(committedRevisionId);
      expect(child).toBeDefined();
      expect(child?.id).toBe(draftRevisionId);
    });

    it('should getRevisionChildren from head', async () => {
      const children = await api.getRevisionChildren(committedRevisionId);
      expect(Array.isArray(children)).toBe(true);
      expect(children.length).toBeGreaterThanOrEqual(1);
    });

    it('should getTablesByRevisionId', async () => {
      const tables = await api.getTablesByRevisionId({
        revisionId: draftRevisionId,
        first: 100,
      });

      const tableIds = tables.edges.map((e) => e.node.id);
      expect(tableIds).toContain('products');
    });
  });

  describe('tableChanges and rowChanges', () => {
    beforeAll(async () => {
      await api.createTable({
        revisionId: draftRevisionId,
        tableId: 'changes-table',
        schema: getObjectSchema({ val: getNumberSchema() }),
      });

      await api.createRow({
        revisionId: draftRevisionId,
        tableId: 'changes-table',
        rowId: 'changes-row',
        data: { val: 42 },
      });
    });

    it('should return table changes', async () => {
      const result = await api.tableChanges({
        revisionId: draftRevisionId,
        first: 100,
      });

      expect(result.edges.length).toBeGreaterThanOrEqual(1);
      const tableIds = result.edges.map((e) => e.node.tableId);
      expect(tableIds).toContain('changes-table');
    });

    it('should return row changes', async () => {
      const result = await api.rowChanges({
        revisionId: draftRevisionId,
        first: 100,
      });

      expect(result.edges.length).toBeGreaterThanOrEqual(1);
    });

    afterAll(async () => {
      try {
        await api.revertChanges({ projectId, branchName });
      } catch {
        // nothing to revert
      }
    });
  });

  describe('branch operations', () => {
    let newBranchId: string;
    const newBranchName = 'test-branch';

    it('should getBranchById', async () => {
      const branch = await api.getBranchById(branchId);
      expect(branch).toBeDefined();
      expect(branch.id).toBe(branchId);
    });

    it('should getBranches', async () => {
      const result = await api.getBranches({
        projectId,
        first: 10,
      });

      expect(result.edges.length).toBeGreaterThanOrEqual(1);
    });

    it('should createBranch from head revision', async () => {
      const head = await api.getHeadRevision(branchId);

      const branch = await api.createBranch({
        revisionId: head.id,
        branchName: newBranchName,
      });

      expect(branch).toBeDefined();
      newBranchId = branch.id;
    });

    it('should getStartRevision', async () => {
      const start = await api.getStartRevision(newBranchId);
      expect(start).toBeDefined();
    });

    it('should getRevisionsByBranchId', async () => {
      const revisions = await api.getRevisionsByBranchId({
        branchId: newBranchId,
        first: 10,
      });

      expect(revisions.edges.length).toBeGreaterThanOrEqual(1);
    });

    it('should deleteBranch', async () => {
      const result = await api.deleteBranch({
        projectId,
        branchName: newBranchName,
      });

      expect(result).toBe(true);
    });
  });

  describe('uploadFile', () => {
    it('should upload a file via mocked storage', async () => {
      await api.createTable({
        revisionId: draftRevisionId,
        tableId: 'file-table',
        schema: getObjectSchema({
          doc: getRefSchema(SystemSchemaIds.File),
        }),
      });

      await api.createRow({
        revisionId: draftRevisionId,
        tableId: 'file-table',
        rowId: 'file-row',
        data: { doc: createEmptyFile() },
      });

      // Read back the row to get the fileId assigned by the file plugin
      const row = await api.getRow({
        revisionId: draftRevisionId,
        tableId: 'file-table',
        rowId: 'file-row',
      });
      const rowData = (row as Record<string, unknown>).data as Record<
        string,
        unknown
      >;
      const docData = rowData.doc as { fileId: string };

      const fakeFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'test.txt',
        encoding: '7bit',
        mimetype: 'text/plain',
        size: 4,
        buffer: Buffer.from('test'),
        destination: '',
        filename: 'test.txt',
        path: '',
        stream: Readable.from(Buffer.from('test')),
      };

      const result = await api.uploadFile({
        revisionId: draftRevisionId,
        tableId: 'file-table',
        rowId: 'file-row',
        fileId: docData.fileId,
        file: fakeFile,
      });

      expect(result.table).toBeDefined();
      expect(result.row).toBeDefined();
    });

    afterAll(async () => {
      try {
        await api.revertChanges({ projectId, branchName });
      } catch {
        // nothing to revert
      }
    });
  });

  describe('getSubSchemaItems', () => {
    it('should return sub-schema items for $ref fields', async () => {
      await api.createTable({
        revisionId: draftRevisionId,
        tableId: 'ref-table',
        schema: getObjectSchema({
          name: getStringSchema(),
          file: getRefSchema(SystemSchemaIds.File),
        }),
      });

      await api.createRow({
        revisionId: draftRevisionId,
        tableId: 'ref-table',
        rowId: 'ref-row',
        data: { name: 'Test', file: createEmptyFile() },
      });

      const result = await api.getSubSchemaItems({
        revisionId: draftRevisionId,
        schemaId: SystemSchemaIds.File,
        first: 100,
      });

      expect(result.totalCount).toBeGreaterThanOrEqual(1);
      const tableIds = result.edges.map((e) => e.node.table.id);
      expect(tableIds).toContain('ref-table');
    });

    afterAll(async () => {
      try {
        await api.revertChanges({ projectId, branchName });
      } catch {
        // nothing to revert
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
