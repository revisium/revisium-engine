import { Readable } from 'stream';
import { nanoid } from 'nanoid';
import {
  getObjectSchema,
  getRefSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import { EngineApiService } from 'src/engine-api.service';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import {
  createEmptyFile,
  prepareProject,
} from 'src/__tests__/utils/prepareProject';
import {
  createEngineE2eTestKit,
  type EngineE2eTestKit,
} from './engine-api.e2e-helper';

const SHA256_LENGTH = 64;
const HEX_CHARS = '0123456789abcdef';

function fakeSha256(seed: string): string {
  let result = '';
  for (let i = 0; i < SHA256_LENGTH; i += 1) {
    const code = seed.charCodeAt(i % seed.length) + i;
    result += HEX_CHARS[code % HEX_CHARS.length];
  }
  return result;
}

function buildFileSchema(): object {
  return getObjectSchema({
    name: getStringSchema(),
    doc: getRefSchema(SystemSchemaIds.File),
  });
}

interface ProjectContext {
  projectId: string;
  branchId: string;
  branchName: string;
  draftRevisionId: string;
}

describe('File Usage E2E', () => {
  let kit: EngineE2eTestKit;
  let api: EngineApiService;
  let prisma: PrismaService;

  let projectId: string;
  let draftRevisionId: string;

  beforeAll(async () => {
    kit = await createEngineE2eTestKit();
    api = kit.api;
    prisma = kit.prisma;
    projectId = kit.projectId;
    draftRevisionId = kit.draftRevisionId;
  });

  afterAll(async () => {
    await kit.close();
  });

  async function createProjectContext(): Promise<ProjectContext> {
    const project = await prepareProject(prisma);
    return {
      projectId: project.projectId,
      branchId: project.branchId,
      branchName: project.branchName,
      draftRevisionId: project.draftRevisionId,
    };
  }

  async function refreshDraftRevisionId(branchId: string): Promise<string> {
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      include: {
        revisions: { where: { isDraft: true } },
      },
    });

    return branch?.revisions[0]?.id ?? '';
  }

  async function simulateConsumerForkFromRevision(args: {
    sourceRevisionId: string;
    branchName?: string;
  }): Promise<ProjectContext> {
    const projectId = `fork-project-${nanoid()}`;
    const branchId = `fork-branch-${nanoid()}`;
    const branchName = args.branchName ?? `fork-${nanoid()}`;
    const headRevisionId = `fork-head-${nanoid()}`;
    const draftRevisionId = `fork-draft-${nanoid()}`;

    const sourceRevision = await prisma.revision.findUniqueOrThrow({
      where: { id: args.sourceRevisionId },
      select: { tables: { select: { versionId: true } } },
    });

    await prisma.branch.create({
      data: {
        id: branchId,
        name: branchName,
        isRoot: true,
        projectId,
      },
    });

    await prisma.revision.create({
      data: {
        id: headRevisionId,
        branchId,
        isHead: true,
        isStart: true,
        hasChanges: false,
        tables: {
          connect: sourceRevision.tables.map((table) => ({
            versionId: table.versionId,
          })),
        },
      },
    });

    await prisma.revision.create({
      data: {
        id: draftRevisionId,
        branchId,
        parentId: headRevisionId,
        isDraft: true,
        hasChanges: false,
        tables: {
          connect: sourceRevision.tables.map((table) => ({
            versionId: table.versionId,
          })),
        },
      },
    });

    return { projectId, branchId, branchName, draftRevisionId };
  }

  function buildMulterFile(args: {
    content: string;
    name: string;
  }): Express.Multer.File {
    const buffer = Buffer.from(args.content);
    return {
      fieldname: 'file',
      originalname: args.name,
      encoding: '7bit',
      mimetype: 'text/plain',
      size: buffer.length,
      buffer,
      destination: '',
      filename: args.name,
      path: '',
      stream: Readable.from(buffer),
    };
  }

  async function ensureDraftTable(args: {
    revisionId: string;
    tableId: string;
    schema: object;
  }): Promise<void> {
    try {
      await api.createTable({
        revisionId: args.revisionId,
        tableId: args.tableId,
        schema: args.schema as never,
      });
    } catch (error) {
      const message = (error as Error).message ?? '';
      if (!message.includes('already exists')) {
        throw error;
      }
    }
  }

  async function createRowWithFilePlaceholder(args: {
    revisionId: string;
    tableId: string;
    rowId: string;
  }): Promise<string> {
    await api.createRow({
      revisionId: args.revisionId,
      tableId: args.tableId,
      rowId: args.rowId,
      data: { name: args.rowId, doc: createEmptyFile() },
    });

    const row = await api.getRow({
      revisionId: args.revisionId,
      tableId: args.tableId,
      rowId: args.rowId,
    });
    const rowData = (row as Record<string, unknown>).data as Record<
      string,
      unknown
    >;
    const docData = rowData.doc as { fileId: string };
    return docData.fileId;
  }

  async function uploadContentForFileId(args: {
    revisionId: string;
    tableId: string;
    rowId: string;
    fileId: string;
    content: string;
    filename: string;
  }): Promise<void> {
    await api.uploadFile({
      revisionId: args.revisionId,
      tableId: args.tableId,
      rowId: args.rowId,
      fileId: args.fileId,
      file: buildMulterFile({
        content: args.content,
        name: args.filename,
      }),
    });
  }

  describe('upload flow populates counter', () => {
    it('increments project storage bytes after uploading a file', async () => {
      const tableId = `upload-table-${nanoid()}`;
      const rowId = `upload-row-${nanoid()}`;
      const content = 'hello world';

      await ensureDraftTable({
        revisionId: draftRevisionId,
        tableId,
        schema: buildFileSchema(),
      });

      const beforeBytes = await api.getProjectStorageBytes({ projectId });

      const fileId = await createRowWithFilePlaceholder({
        revisionId: draftRevisionId,
        tableId,
        rowId,
      });
      draftRevisionId = await kit.refreshDraftRevisionId();

      await uploadContentForFileId({
        revisionId: draftRevisionId,
        tableId,
        rowId,
        fileId,
        content,
        filename: 'hello.txt',
      });

      const afterBytes = await api.getProjectStorageBytes({ projectId });
      const delta = afterBytes - beforeBytes;
      expect(delta).toBe(BigInt(content.length));

      const blobs = await prisma.fileBlob.findMany({
        where: { projectId },
      });
      expect(blobs.length).toBeGreaterThanOrEqual(1);
    });

    it('does not double-count when two rows upload the same content', async () => {
      const tableId = `dedup-table-${nanoid()}`;
      const content = 'shared content bytes';
      const expectedSize = BigInt(content.length);

      await ensureDraftTable({
        revisionId: draftRevisionId,
        tableId,
        schema: buildFileSchema(),
      });

      const beforeBytes = await api.getProjectStorageBytes({ projectId });

      const firstRowId = `shared-row-1-${nanoid()}`;
      const secondRowId = `shared-row-2-${nanoid()}`;

      const firstFileId = await createRowWithFilePlaceholder({
        revisionId: draftRevisionId,
        tableId,
        rowId: firstRowId,
      });
      draftRevisionId = await kit.refreshDraftRevisionId();

      await uploadContentForFileId({
        revisionId: draftRevisionId,
        tableId,
        rowId: firstRowId,
        fileId: firstFileId,
        content,
        filename: 'shared.txt',
      });

      const secondFileId = await createRowWithFilePlaceholder({
        revisionId: draftRevisionId,
        tableId,
        rowId: secondRowId,
      });
      draftRevisionId = await kit.refreshDraftRevisionId();

      await uploadContentForFileId({
        revisionId: draftRevisionId,
        tableId,
        rowId: secondRowId,
        fileId: secondFileId,
        content,
        filename: 'shared-again.txt',
      });

      const afterBytes = await api.getProjectStorageBytes({ projectId });
      expect(afterBytes - beforeBytes).toBe(expectedSize);
    });

    it('does not double-count under concurrent uploads of the same content to different rows', async () => {
      const localProject = await createProjectContext();
      const tableId = `concurrent-shared-table-${nanoid()}`;
      const firstRowId = `concurrent-shared-row-a-${nanoid()}`;
      const secondRowId = `concurrent-shared-row-b-${nanoid()}`;
      const content = `concurrent shared bytes ${nanoid()}`;

      await ensureDraftTable({
        revisionId: localProject.draftRevisionId,
        tableId,
        schema: buildFileSchema(),
      });

      const firstFileId = await createRowWithFilePlaceholder({
        revisionId: localProject.draftRevisionId,
        tableId,
        rowId: firstRowId,
      });
      localProject.draftRevisionId = await refreshDraftRevisionId(
        localProject.branchId,
      );

      const secondFileId = await createRowWithFilePlaceholder({
        revisionId: localProject.draftRevisionId,
        tableId,
        rowId: secondRowId,
      });
      localProject.draftRevisionId = await refreshDraftRevisionId(
        localProject.branchId,
      );

      const before = await api.getProjectStorageBytes({
        projectId: localProject.projectId,
      });

      await Promise.all([
        uploadContentForFileId({
          revisionId: localProject.draftRevisionId,
          tableId,
          rowId: firstRowId,
          fileId: firstFileId,
          content,
          filename: 'concurrent-a.txt',
        }),
        uploadContentForFileId({
          revisionId: localProject.draftRevisionId,
          tableId,
          rowId: secondRowId,
          fileId: secondFileId,
          content,
          filename: 'concurrent-b.txt',
        }),
      ]);
      localProject.draftRevisionId = await refreshDraftRevisionId(
        localProject.branchId,
      );

      const after = await api.getProjectStorageBytes({
        projectId: localProject.projectId,
      });
      expect(after - before).toBe(BigInt(content.length));

      const report = await api.validateProjectFileBytes({
        projectId: localProject.projectId,
      });
      expect(report.fileBlobCount).toBe(1);
      expect(report.referenceCount).toBe(2);
      expect(report.drift).toBe(0n);
    });

    it('getStorageBytesForProjects sums across a list of projects', async () => {
      const tableId = `agg-table-${nanoid()}`;
      const rowId = `agg-row-${nanoid()}`;
      const content = 'content for aggregation';

      await ensureDraftTable({
        revisionId: draftRevisionId,
        tableId,
        schema: buildFileSchema(),
      });

      const beforeTotal = await api.getStorageBytesForProjects({
        projectIds: [projectId, 'nonexistent-project-id'],
      });

      const fileId = await createRowWithFilePlaceholder({
        revisionId: draftRevisionId,
        tableId,
        rowId,
      });
      draftRevisionId = await kit.refreshDraftRevisionId();

      await uploadContentForFileId({
        revisionId: draftRevisionId,
        tableId,
        rowId,
        fileId,
        content,
        filename: 'agg.txt',
      });

      const afterTotal = await api.getStorageBytesForProjects({
        projectIds: [projectId, 'nonexistent-project-id'],
      });

      expect(afterTotal - beforeTotal).toBe(BigInt(content.length));
    });
  });

  describe('reconciliation APIs', () => {
    it('validate reports drift after manual counter tampering and restore fixes it', async () => {
      const tableId = `drift-table-${nanoid()}`;
      const rowId = `drift-row-${nanoid()}`;
      const content = 'some drift content';

      await ensureDraftTable({
        revisionId: draftRevisionId,
        tableId,
        schema: buildFileSchema(),
      });

      const fileId = await createRowWithFilePlaceholder({
        revisionId: draftRevisionId,
        tableId,
        rowId,
      });
      draftRevisionId = await kit.refreshDraftRevisionId();

      await uploadContentForFileId({
        revisionId: draftRevisionId,
        tableId,
        rowId,
        fileId,
        content,
        filename: 'drift.txt',
      });

      await prisma.projectFileUsage.upsert({
        where: { projectId },
        create: { projectId, fileBytes: 0n },
        update: { fileBytes: 0n },
      });

      const before = await api.validateProjectFileBytes({ projectId });
      expect(before.currentFileBytes).toBe(0n);
      expect(before.expectedFileBytes).toBeGreaterThan(0n);

      const restored = await api.restoreProjectFileBytes({ projectId });
      expect(restored.nextFileBytes).toBe(before.expectedFileBytes);

      const after = await api.validateProjectFileBytes({ projectId });
      expect(after.drift).toBe(0n);
    });

    it('backfill populates FileBlob rows for a project with blob data stripped', async () => {
      const tableId = `backfill-table-${nanoid()}`;
      const rowId = `backfill-row-${nanoid()}`;
      const content = 'backfill content';

      await ensureDraftTable({
        revisionId: draftRevisionId,
        tableId,
        schema: buildFileSchema(),
      });

      const fileId = await createRowWithFilePlaceholder({
        revisionId: draftRevisionId,
        tableId,
        rowId,
      });
      draftRevisionId = await kit.refreshDraftRevisionId();

      await uploadContentForFileId({
        revisionId: draftRevisionId,
        tableId,
        rowId,
        fileId,
        content,
        filename: 'backfill.txt',
      });

      await prisma.fileBlob.deleteMany({ where: { projectId } });
      await prisma.projectFileUsage.upsert({
        where: { projectId },
        create: { projectId, fileBytes: 0n },
        update: { fileBytes: 0n },
      });

      const dryRun = await api.backfillProjectFileBlobs({
        projectId,
        dryRun: true,
      });
      expect(dryRun.dryRun).toBe(true);
      expect(dryRun.blobsCreated).toBeGreaterThanOrEqual(1);
      expect(dryRun.fileBytesAfter).toBeGreaterThan(0n);

      const applied = await api.backfillProjectFileBlobs({ projectId });
      expect(applied.dryRun).toBe(false);
      expect(applied.fileBytesAfter).toBe(dryRun.fileBytesAfter);

      const actual = await api.getProjectStorageBytes({ projectId });
      expect(actual).toBe(applied.fileBytesAfter);
    });
  });

  describe('removeRows hook decrements the counter in real time', () => {
    it('tombstones FileBlobs whose last row was just removed', async () => {
      const tableId = `remove-table-${nanoid()}`;
      const rowId = `remove-row-${nanoid()}`;
      const content = 'bytes for real-time removal';

      await ensureDraftTable({
        revisionId: draftRevisionId,
        tableId,
        schema: buildFileSchema(),
      });

      const fileId = await createRowWithFilePlaceholder({
        revisionId: draftRevisionId,
        tableId,
        rowId,
      });
      draftRevisionId = await kit.refreshDraftRevisionId();

      await uploadContentForFileId({
        revisionId: draftRevisionId,
        tableId,
        rowId,
        fileId,
        content,
        filename: 'remove.txt',
      });

      const bytesAfterUpload = await api.getProjectStorageBytes({ projectId });

      await api.removeRow({
        revisionId: draftRevisionId,
        tableId,
        rowId,
      });
      draftRevisionId = await kit.refreshDraftRevisionId();

      const bytesAfterRemove = await api.getProjectStorageBytes({ projectId });
      expect(bytesAfterUpload - bytesAfterRemove).toBe(BigInt(content.length));

      const active = await prisma.fileBlob.count({
        where: { projectId, deletedAt: null, size: BigInt(content.length) },
      });
      expect(active).toBe(0);
    });
  });

  describe('orphan cleanup integrates with cleanOrphanedData', () => {
    it('cleanOrphanedData sweeps orphan FileBlobs', async () => {
      const orphanHash = fakeSha256(`orphan-${nanoid()}`);

      await prisma.fileBlob.create({
        data: {
          projectId,
          hash: orphanHash,
          size: 42n,
        },
      });
      await prisma.projectFileUsage.upsert({
        where: { projectId },
        create: { projectId, fileBytes: 42n },
        update: { fileBytes: { increment: 42n } },
      });

      const result = await api.cleanOrphanedData();

      expect(result.fileBlobsTombstoned).toBeGreaterThanOrEqual(1);
      expect(result.fileBytesFreed).toBeGreaterThanOrEqual(42n);

      const remainingOrphan = await prisma.fileBlob.findFirst({
        where: { projectId, hash: orphanHash },
      });
      expect(remainingOrphan).not.toBeNull();
      expect(remainingOrphan?.deletedAt).not.toBeNull();
      expect(result.orphanHashes).toContain(orphanHash);
    });
  });

  describe('consumer race and isolation scenarios', () => {
    it('reactivates a tombstoned hash and ignores stale storage confirmation', async () => {
      const localProject = await createProjectContext();
      const tableId = `reactivate-table-${nanoid()}`;
      const firstRowId = `reactivate-row-1-${nanoid()}`;
      const secondRowId = `reactivate-row-2-${nanoid()}`;
      const content = `reactivation content bytes ${nanoid()}`;

      await ensureDraftTable({
        revisionId: localProject.draftRevisionId,
        tableId,
        schema: buildFileSchema(),
      });

      const firstFileId = await createRowWithFilePlaceholder({
        revisionId: localProject.draftRevisionId,
        tableId,
        rowId: firstRowId,
      });
      localProject.draftRevisionId = await refreshDraftRevisionId(
        localProject.branchId,
      );

      await uploadContentForFileId({
        revisionId: localProject.draftRevisionId,
        tableId,
        rowId: firstRowId,
        fileId: firstFileId,
        content,
        filename: 'reactivate-a.txt',
      });
      localProject.draftRevisionId = await refreshDraftRevisionId(
        localProject.branchId,
      );

      const cleanupResult = await api.cleanupProjectFileUsage({
        projectId: localProject.projectId,
      });
      expect(cleanupResult.orphanHashes).toHaveLength(1);

      const pendingBefore = await api.getPendingStorageDeletions({
        limit: 1000,
      });
      expect(pendingBefore.map((item) => item.hash)).toContain(
        cleanupResult.orphanHashes[0],
      );

      const secondFileId = await createRowWithFilePlaceholder({
        revisionId: localProject.draftRevisionId,
        tableId,
        rowId: secondRowId,
      });
      localProject.draftRevisionId = await refreshDraftRevisionId(
        localProject.branchId,
      );

      await uploadContentForFileId({
        revisionId: localProject.draftRevisionId,
        tableId,
        rowId: secondRowId,
        fileId: secondFileId,
        content,
        filename: 'reactivate-b.txt',
      });
      localProject.draftRevisionId = await refreshDraftRevisionId(
        localProject.branchId,
      );

      const bytesAfterReupload = await api.getProjectStorageBytes({
        projectId: localProject.projectId,
      });
      expect(bytesAfterReupload).toBe(BigInt(content.length));

      const staleConfirm = await api.confirmStorageDeleted({
        hashes: cleanupResult.orphanHashes,
      });
      expect(staleConfirm.hashesConfirmed).toBe(1);
      expect(staleConfirm.blobsDeleted).toBe(0);

      const activeBlob = await prisma.fileBlob.findFirst({
        where: {
          projectId: localProject.projectId,
          hash: cleanupResult.orphanHashes[0],
          deletedAt: null,
        },
      });
      expect(activeBlob).not.toBeNull();

      const pendingAfter = await api.getPendingStorageDeletions({
        limit: 1000,
      });
      expect(pendingAfter.map((item) => item.hash)).not.toContain(
        cleanupResult.orphanHashes[0],
      );
    });

    it('keeps cross-project shared hashes out of orphan and pending-deletion results', async () => {
      const secondProject = await createProjectContext();
      const sharedHash = fakeSha256(`shared-${nanoid()}`);
      const sharedSize = 321n;

      await prisma.fileBlob.create({
        data: { projectId, hash: sharedHash, size: sharedSize },
      });
      await prisma.projectFileUsage.upsert({
        where: { projectId },
        create: { projectId, fileBytes: sharedSize },
        update: { fileBytes: { increment: sharedSize } },
      });

      await prisma.fileBlob.create({
        data: {
          projectId: secondProject.projectId,
          hash: sharedHash,
          size: sharedSize,
        },
      });
      await prisma.projectFileUsage.upsert({
        where: { projectId: secondProject.projectId },
        create: { projectId: secondProject.projectId, fileBytes: sharedSize },
        update: { fileBytes: { increment: sharedSize } },
      });

      const cleanupResult = await api.cleanupProjectFileUsage({ projectId });
      expect(cleanupResult.projectId).toBe(projectId);
      expect(cleanupResult.orphanHashes).not.toContain(sharedHash);

      const pending = await api.getPendingStorageDeletions({ limit: 10 });
      expect(pending.map((item) => item.hash)).not.toContain(sharedHash);

      const survivingOtherProjectBlob = await prisma.fileBlob.findFirst({
        where: {
          projectId: secondProject.projectId,
          hash: sharedHash,
          deletedAt: null,
        },
      });
      expect(survivingOtherProjectBlob).not.toBeNull();
    });

    it('cleans only project-scoped orphan blobs when using cleanupOrphanedFileBlobsForProject', async () => {
      const secondProject = await createProjectContext();
      const firstHash = fakeSha256(`first-${nanoid()}`);
      const secondHash = fakeSha256(`second-${nanoid()}`);

      await prisma.fileBlob.create({
        data: { projectId, hash: firstHash, size: 100n },
      });
      await prisma.projectFileUsage.upsert({
        where: { projectId },
        create: { projectId, fileBytes: 100n },
        update: { fileBytes: { increment: 100n } },
      });

      await prisma.fileBlob.create({
        data: {
          projectId: secondProject.projectId,
          hash: secondHash,
          size: 200n,
        },
      });
      await prisma.projectFileUsage.upsert({
        where: { projectId: secondProject.projectId },
        create: { projectId: secondProject.projectId, fileBytes: 200n },
        update: { fileBytes: { increment: 200n } },
      });

      const cleanupResult = await api.cleanupOrphanedFileBlobsForProject({
        projectId,
      });

      expect(cleanupResult.blobsTombstoned).toBe(1);
      expect(cleanupResult.bytesFreed).toBe(100n);
      expect(cleanupResult.orphanHashes).toEqual([firstHash]);

      const firstProjectUsage = await api.getProjectStorageBytes({ projectId });
      const secondProjectUsage = await api.getProjectStorageBytes({
        projectId: secondProject.projectId,
      });
      expect(firstProjectUsage).toBe(0n);
      expect(secondProjectUsage).toBe(200n);
    });

    it('keeps reverted draft uploads billed until cleanup removes orphan row versions', async () => {
      const tableId = `revert-table-${nanoid()}`;
      const rowId = `revert-row-${nanoid()}`;
      const content = 'draft-only revert content';

      await ensureDraftTable({
        revisionId: draftRevisionId,
        tableId,
        schema: buildFileSchema(),
      });

      const fileId = await createRowWithFilePlaceholder({
        revisionId: draftRevisionId,
        tableId,
        rowId,
      });
      draftRevisionId = await kit.refreshDraftRevisionId();

      await uploadContentForFileId({
        revisionId: draftRevisionId,
        tableId,
        rowId,
        fileId,
        content,
        filename: 'revert.txt',
      });
      draftRevisionId = await kit.refreshDraftRevisionId();

      const bytesBeforeRevert = await api.getProjectStorageBytes({ projectId });
      expect(bytesBeforeRevert).toBe(BigInt(content.length));

      await kit.revertDraftChanges();
      draftRevisionId = await kit.refreshDraftRevisionId();

      const bytesAfterRevert = await api.getProjectStorageBytes({ projectId });
      expect(bytesAfterRevert).toBe(bytesBeforeRevert);

      const cleanupResult = await api.cleanOrphanedData();
      expect(cleanupResult.fileBlobsTombstoned).toBeGreaterThanOrEqual(1);
      expect(cleanupResult.orphanHashes.length).toBeGreaterThanOrEqual(1);

      const bytesAfterCleanup = await api.getProjectStorageBytes({ projectId });
      expect(bytesAfterCleanup).toBe(0n);
    });

    it('keeps bytes unchanged when a draft row is renamed because the same mutable row version retains its blob link', async () => {
      const localProject = await createProjectContext();
      const tableId = `rename-table-${nanoid()}`;
      const rowId = `rename-row-${nanoid()}`;
      const nextRowId = `rename-row-next-${nanoid()}`;
      const content = `rename content ${nanoid()}`;

      await ensureDraftTable({
        revisionId: localProject.draftRevisionId,
        tableId,
        schema: buildFileSchema(),
      });

      const fileId = await createRowWithFilePlaceholder({
        revisionId: localProject.draftRevisionId,
        tableId,
        rowId,
      });
      localProject.draftRevisionId = await refreshDraftRevisionId(
        localProject.branchId,
      );

      await uploadContentForFileId({
        revisionId: localProject.draftRevisionId,
        tableId,
        rowId,
        fileId,
        content,
        filename: 'rename.txt',
      });
      localProject.draftRevisionId = await refreshDraftRevisionId(
        localProject.branchId,
      );

      const bytesBeforeRename = await api.getProjectStorageBytes({
        projectId: localProject.projectId,
      });

      await api.renameRow({
        revisionId: localProject.draftRevisionId,
        tableId,
        rowId,
        nextRowId,
      });
      localProject.draftRevisionId = await refreshDraftRevisionId(
        localProject.branchId,
      );

      const bytesAfterRename = await api.getProjectStorageBytes({
        projectId: localProject.projectId,
      });
      expect(bytesAfterRename).toBe(bytesBeforeRename);

      const report = await api.validateProjectFileBytes({
        projectId: localProject.projectId,
      });
      expect(report.fileBlobCount).toBe(1);
      expect(report.referenceCount).toBe(1);
      expect(report.expectedFileBytes).toBe(BigInt(content.length));
    });

    it('does not double-count when updateRow keeps the same uploaded hash on an existing draft row', async () => {
      const localProject = await createProjectContext();
      const tableId = `same-hash-table-${nanoid()}`;
      const rowId = `same-hash-row-${nanoid()}`;
      const content = `same hash content ${nanoid()}`;

      await ensureDraftTable({
        revisionId: localProject.draftRevisionId,
        tableId,
        schema: buildFileSchema(),
      });

      const fileId = await createRowWithFilePlaceholder({
        revisionId: localProject.draftRevisionId,
        tableId,
        rowId,
      });
      localProject.draftRevisionId = await refreshDraftRevisionId(
        localProject.branchId,
      );

      await uploadContentForFileId({
        revisionId: localProject.draftRevisionId,
        tableId,
        rowId,
        fileId,
        content,
        filename: 'same-hash-a.txt',
      });
      localProject.draftRevisionId = await refreshDraftRevisionId(
        localProject.branchId,
      );

      const originalRow = (await api.getRow({
        revisionId: localProject.draftRevisionId,
        tableId,
        rowId,
      })) as Record<string, unknown>;
      const originalData = originalRow.data as Record<string, unknown>;
      const uploadedFile = originalData.doc;

      const before = await api.getProjectStorageBytes({
        projectId: localProject.projectId,
      });

      await api.updateRow({
        revisionId: localProject.draftRevisionId,
        tableId,
        rowId,
        data: {
          name: `${rowId}-updated`,
          doc: uploadedFile,
        } as never,
      });
      localProject.draftRevisionId = await refreshDraftRevisionId(
        localProject.branchId,
      );

      const after = await api.getProjectStorageBytes({
        projectId: localProject.projectId,
      });
      expect(after).toBe(before);

      const report = await api.validateProjectFileBytes({
        projectId: localProject.projectId,
      });
      expect(report.fileBlobCount).toBe(1);
      expect(report.referenceCount).toBe(1);
      expect(report.expectedFileBytes).toBe(before);
    });

    it('replaces the billed hash immediately when an existing draft row changes to a different uploaded file', async () => {
      const localProject = await createProjectContext();
      const tableId = `update-table-${nanoid()}`;
      const rowId = `update-row-${nanoid()}`;
      const firstContent = `old-bytes-${nanoid()}`;
      const secondContent = `new-bytes-${nanoid()}-extra`;

      await ensureDraftTable({
        revisionId: localProject.draftRevisionId,
        tableId,
        schema: buildFileSchema(),
      });

      const fileId = await createRowWithFilePlaceholder({
        revisionId: localProject.draftRevisionId,
        tableId,
        rowId,
      });
      localProject.draftRevisionId = await refreshDraftRevisionId(
        localProject.branchId,
      );

      await uploadContentForFileId({
        revisionId: localProject.draftRevisionId,
        tableId,
        rowId,
        fileId,
        content: firstContent,
        filename: 'old.txt',
      });
      localProject.draftRevisionId = await refreshDraftRevisionId(
        localProject.branchId,
      );

      const rowBeforeUpdate = (await api.getRow({
        revisionId: localProject.draftRevisionId,
        tableId,
        rowId,
      })) as Record<string, unknown>;
      const fileBeforeUpdate = ((
        rowBeforeUpdate.data as Record<string, unknown>
      ).doc ?? {}) as { fileId: string };

      await uploadContentForFileId({
        revisionId: localProject.draftRevisionId,
        tableId,
        rowId,
        fileId: fileBeforeUpdate.fileId,
        content: secondContent,
        filename: 'new.txt',
      });
      localProject.draftRevisionId = await refreshDraftRevisionId(
        localProject.branchId,
      );

      const bytesAfterUpdate = await api.getProjectStorageBytes({
        projectId: localProject.projectId,
      });
      expect(bytesAfterUpdate).toBe(BigInt(secondContent.length));

      const beforeCleanup = await api.validateProjectFileBytes({
        projectId: localProject.projectId,
      });
      expect(beforeCleanup.fileBlobCount).toBe(1);
      expect(beforeCleanup.referenceCount).toBe(1);
      expect(beforeCleanup.expectedFileBytes).toBe(
        BigInt(secondContent.length),
      );

      const tombstonedOldBlob = await prisma.fileBlob.findFirst({
        where: {
          projectId: localProject.projectId,
          size: BigInt(firstContent.length),
          deletedAt: { not: null },
        },
      });
      expect(tombstonedOldBlob).not.toBeNull();
    });

    it('remains internally consistent under concurrent uploads of different contents to the same draft row', async () => {
      const localProject = await createProjectContext();
      const tableId = `concurrent-row-table-${nanoid()}`;
      const rowId = `concurrent-row-${nanoid()}`;
      const initialContent = `initial-${nanoid()}`;
      const nextContentA = `next-a-${nanoid()}`;
      const nextContentB = `next-b-${nanoid()}-more`;

      await ensureDraftTable({
        revisionId: localProject.draftRevisionId,
        tableId,
        schema: buildFileSchema(),
      });

      const fileId = await createRowWithFilePlaceholder({
        revisionId: localProject.draftRevisionId,
        tableId,
        rowId,
      });
      localProject.draftRevisionId = await refreshDraftRevisionId(
        localProject.branchId,
      );

      await uploadContentForFileId({
        revisionId: localProject.draftRevisionId,
        tableId,
        rowId,
        fileId,
        content: initialContent,
        filename: 'initial.txt',
      });
      localProject.draftRevisionId = await refreshDraftRevisionId(
        localProject.branchId,
      );

      await Promise.all([
        uploadContentForFileId({
          revisionId: localProject.draftRevisionId,
          tableId,
          rowId,
          fileId,
          content: nextContentA,
          filename: 'race-a.txt',
        }),
        uploadContentForFileId({
          revisionId: localProject.draftRevisionId,
          tableId,
          rowId,
          fileId,
          content: nextContentB,
          filename: 'race-b.txt',
        }),
      ]);
      localProject.draftRevisionId = await refreshDraftRevisionId(
        localProject.branchId,
      );

      const row = (await api.getRow({
        revisionId: localProject.draftRevisionId,
        tableId,
        rowId,
      })) as Record<string, unknown>;
      const rowFile = ((row.data as Record<string, unknown>).doc ?? {}) as {
        size: number;
      };

      const expectedSizes = new Set([nextContentA.length, nextContentB.length]);
      expect(expectedSizes.has(rowFile.size)).toBe(true);

      const bytes = await api.getProjectStorageBytes({
        projectId: localProject.projectId,
      });
      expect(bytes).toBe(BigInt(rowFile.size));

      const report = await api.validateProjectFileBytes({
        projectId: localProject.projectId,
      });
      expect(report.fileBlobCount).toBe(1);
      expect(report.referenceCount).toBe(1);
      expect(report.drift).toBe(0n);
    });

    it('frees bytes immediately when removing a renamed draft row because the active mutable row version was removed', async () => {
      const localProject = await createProjectContext();
      const tableId = `rename-remove-table-${nanoid()}`;
      const rowId = `rename-remove-row-${nanoid()}`;
      const nextRowId = `rename-remove-next-${nanoid()}`;
      const content = `rename-remove content ${nanoid()}`;

      await ensureDraftTable({
        revisionId: localProject.draftRevisionId,
        tableId,
        schema: buildFileSchema(),
      });

      const fileId = await createRowWithFilePlaceholder({
        revisionId: localProject.draftRevisionId,
        tableId,
        rowId,
      });
      localProject.draftRevisionId = await refreshDraftRevisionId(
        localProject.branchId,
      );

      await uploadContentForFileId({
        revisionId: localProject.draftRevisionId,
        tableId,
        rowId,
        fileId,
        content,
        filename: 'rename-remove.txt',
      });
      localProject.draftRevisionId = await refreshDraftRevisionId(
        localProject.branchId,
      );

      await api.renameRow({
        revisionId: localProject.draftRevisionId,
        tableId,
        rowId,
        nextRowId,
      });
      localProject.draftRevisionId = await refreshDraftRevisionId(
        localProject.branchId,
      );

      const bytesBeforeRemove = await api.getProjectStorageBytes({
        projectId: localProject.projectId,
      });

      await api.removeRow({
        revisionId: localProject.draftRevisionId,
        tableId,
        rowId: nextRowId,
      });
      localProject.draftRevisionId = await refreshDraftRevisionId(
        localProject.branchId,
      );

      const bytesAfterRemove = await api.getProjectStorageBytes({
        projectId: localProject.projectId,
      });
      expect(bytesAfterRemove).toBe(0n);

      const rowAfterRemove = await api.getRow({
        revisionId: localProject.draftRevisionId,
        tableId,
        rowId: nextRowId,
      });
      expect(rowAfterRemove).toBeNull();

      const tombstonedBlob = await prisma.fileBlob.findFirst({
        where: {
          projectId: localProject.projectId,
          size: bytesBeforeRemove,
          deletedAt: { not: null },
        },
      });
      expect(tombstonedBlob).not.toBeNull();
    });

    it('treats repeated cleanupProjectFileUsage calls as bounded retries', async () => {
      const localProject = await createProjectContext();
      const tableId = `cleanup-retry-table-${nanoid()}`;
      const rowId = `cleanup-retry-row-${nanoid()}`;
      const content = `cleanup retry content ${nanoid()}`;

      await ensureDraftTable({
        revisionId: localProject.draftRevisionId,
        tableId,
        schema: buildFileSchema(),
      });

      const fileId = await createRowWithFilePlaceholder({
        revisionId: localProject.draftRevisionId,
        tableId,
        rowId,
      });
      localProject.draftRevisionId = await refreshDraftRevisionId(
        localProject.branchId,
      );

      await uploadContentForFileId({
        revisionId: localProject.draftRevisionId,
        tableId,
        rowId,
        fileId,
        content,
        filename: 'cleanup-retry.txt',
      });
      localProject.draftRevisionId = await refreshDraftRevisionId(
        localProject.branchId,
      );

      const first = await api.cleanupProjectFileUsage({
        projectId: localProject.projectId,
      });
      expect(first.blobsTombstoned).toBeGreaterThanOrEqual(1);
      expect(first.bytesFreed).toBe(BigInt(content.length));

      const second = await api.cleanupProjectFileUsage({
        projectId: localProject.projectId,
      });
      expect(second.blobsTombstoned).toBe(0);
      expect(second.bytesFreed).toBe(0n);
      expect(second.orphanHashes).toHaveLength(0);
    });

    it('backfills a consumer-style forked project that reuses source revision tables under a new projectId', async () => {
      const sourceProject = await createProjectContext();
      const tableId = `fork-source-table-${nanoid()}`;
      const rowId = `fork-source-row-${nanoid()}`;
      const content = `fork-source-content-${nanoid()}`;

      await ensureDraftTable({
        revisionId: sourceProject.draftRevisionId,
        tableId,
        schema: buildFileSchema(),
      });

      const fileId = await createRowWithFilePlaceholder({
        revisionId: sourceProject.draftRevisionId,
        tableId,
        rowId,
      });
      sourceProject.draftRevisionId = await refreshDraftRevisionId(
        sourceProject.branchId,
      );

      await uploadContentForFileId({
        revisionId: sourceProject.draftRevisionId,
        tableId,
        rowId,
        fileId,
        content,
        filename: 'fork-source.txt',
      });
      sourceProject.draftRevisionId = await refreshDraftRevisionId(
        sourceProject.branchId,
      );

      await api.createRevision({
        projectId: sourceProject.projectId,
        branchName: sourceProject.branchName,
        comment: 'commit before fork',
      });

      const uploadedBlob = await prisma.fileBlob.findFirstOrThrow({
        where: { projectId: sourceProject.projectId, deletedAt: null },
        select: { hash: true },
      });

      const sourceHead = await api.getHeadRevision(sourceProject.branchId);
      const forkProject = await simulateConsumerForkFromRevision({
        sourceRevisionId: sourceHead.id,
      });

      const preview = await api.backfillProjectFileBlobs({
        projectId: forkProject.projectId,
        dryRun: true,
      });
      expect(preview.blobsCreated).toBe(1);
      expect(preview.referencesCreated).toBe(1);
      expect(preview.fileBytesAfter).toBe(BigInt(content.length));

      const applied = await api.backfillProjectFileBlobs({
        projectId: forkProject.projectId,
      });
      expect(applied.blobsCreated).toBe(1);
      expect(applied.fileBytesAfter).toBe(BigInt(content.length));

      const forkBytes = await api.getProjectStorageBytes({
        projectId: forkProject.projectId,
      });
      expect(forkBytes).toBe(BigInt(content.length));

      const sourceCleanup = await api.cleanupProjectFileUsage({
        projectId: sourceProject.projectId,
      });
      expect(sourceCleanup.orphanHashes).not.toContain(uploadedBlob.hash);

      const pending = await api.getPendingStorageDeletions({ limit: 1000 });
      expect(pending.map((item) => item.hash)).not.toContain(uploadedBlob.hash);

      const forkReport = await api.validateProjectFileBytes({
        projectId: forkProject.projectId,
      });
      expect(forkReport.fileBlobCount).toBe(1);
      expect(forkReport.referenceCount).toBe(1);
      expect(forkReport.drift).toBe(0n);
    });
  });

  describe('cleanupProjectFileUsage', () => {
    it('removes all FileBlobs and counter for a project', async () => {
      const tableId = `cleanup-table-${nanoid()}`;
      const rowId = `cleanup-row-${nanoid()}`;
      const content = 'cleanup content bytes';

      await ensureDraftTable({
        revisionId: draftRevisionId,
        tableId,
        schema: buildFileSchema(),
      });

      const fileId = await createRowWithFilePlaceholder({
        revisionId: draftRevisionId,
        tableId,
        rowId,
      });
      draftRevisionId = await kit.refreshDraftRevisionId();

      await uploadContentForFileId({
        revisionId: draftRevisionId,
        tableId,
        rowId,
        fileId,
        content,
        filename: 'cleanup.txt',
      });

      const before = await prisma.fileBlob.count({
        where: { projectId, deletedAt: null },
      });
      expect(before).toBeGreaterThanOrEqual(1);

      const result = await api.cleanupProjectFileUsage({ projectId });
      expect(result.blobsTombstoned).toBeGreaterThanOrEqual(1);
      expect(result.bytesFreed).toBeGreaterThan(0n);

      const activeAfter = await prisma.fileBlob.count({
        where: { projectId, deletedAt: null },
      });
      expect(activeAfter).toBe(0);

      const tombstonedAfter = await prisma.fileBlob.count({
        where: { projectId, deletedAt: { not: null } },
      });
      expect(tombstonedAfter).toBeGreaterThanOrEqual(1);

      const usage = await prisma.projectFileUsage.findUnique({
        where: { projectId },
      });
      expect(usage).toBeNull();
    });
  });
});
