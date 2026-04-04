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
      // After commit, draftRevisionId changes
      const branch = await prisma.branch.findUnique({
        where: { id: branchId },
        include: {
          revisions: { where: { isDraft: true } },
        },
      });
      draftRevisionId = (branch?.revisions[0] as { id: string }).id;
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
});
