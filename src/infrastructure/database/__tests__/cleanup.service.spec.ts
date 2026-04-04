import { nanoid } from 'nanoid';
import { createTestingModule } from 'src/features/draft/commands/handlers/__tests__/utils';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { CleanupService } from 'src/infrastructure/database/cleanup.service';

describe('CleanupService', () => {
  let prismaService: PrismaService;
  let cleanupService: CleanupService;

  beforeAll(async () => {
    const result = await createTestingModule();
    prismaService = result.prismaService;
    cleanupService = result.module.get(CleanupService);
  });

  it('should delete orphaned tables', async () => {
    const orphanedTableVersionId = nanoid();

    await prismaService.table.create({
      data: {
        versionId: orphanedTableVersionId,
        createdId: nanoid(),
        id: 'orphaned-table',
      },
    });

    const before = await prismaService.table.findUnique({
      where: { versionId: orphanedTableVersionId },
    });
    expect(before).toBeDefined();

    const result = await cleanupService.cleanOrphanedData();
    expect(result.tables).toBeGreaterThanOrEqual(1);

    const after = await prismaService.table.findUnique({
      where: { versionId: orphanedTableVersionId },
    });
    expect(after).toBeNull();
  });

  it('should delete orphaned rows', async () => {
    const orphanedRowVersionId = nanoid();

    await prismaService.row.create({
      data: {
        versionId: orphanedRowVersionId,
        createdId: nanoid(),
        id: 'orphaned-row',
        data: {},
        hash: 'test-hash',
        schemaHash: 'test-schema-hash',
      },
    });

    const before = await prismaService.row.findUnique({
      where: { versionId: orphanedRowVersionId },
    });
    expect(before).toBeDefined();

    const result = await cleanupService.cleanOrphanedData();
    expect(result.rows).toBeGreaterThanOrEqual(1);

    const after = await prismaService.row.findUnique({
      where: { versionId: orphanedRowVersionId },
    });
    expect(after).toBeNull();
  });

  it('should not delete tables connected to revisions', async () => {
    const branchId = nanoid();
    const revisionId = nanoid();
    const tableVersionId = nanoid();

    await prismaService.branch.create({
      data: {
        id: branchId,
        name: `branch-${branchId}`,
        projectId: nanoid(),
        revisions: {
          create: {
            id: revisionId,
            isHead: true,
          },
        },
      },
    });

    await prismaService.table.create({
      data: {
        versionId: tableVersionId,
        createdId: nanoid(),
        id: 'connected-table',
        revisions: { connect: { id: revisionId } },
      },
    });

    await cleanupService.cleanOrphanedData();

    const table = await prismaService.table.findUnique({
      where: { versionId: tableVersionId },
    });
    expect(table).toBeDefined();
  });

  it('should return zero counts when nothing to clean', async () => {
    await cleanupService.cleanOrphanedData();
    const result = await cleanupService.cleanOrphanedData();

    expect(result.tables).toBe(0);
    expect(result.rows).toBe(0);
  });
});
