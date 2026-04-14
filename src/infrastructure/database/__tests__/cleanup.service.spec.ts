import { nanoid } from 'nanoid';
import type { DatabaseServiceTestKit } from 'src/__tests__/kit/create-database-service-test-kit';
import { createDatabaseServiceTestKit } from 'src/__tests__/kit/create-database-service-test-kit';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { CleanupService } from 'src/infrastructure/database/cleanup.service';

describe('CleanupService', () => {
  let kit: DatabaseServiceTestKit;
  let prismaService: PrismaService;
  let cleanupService: CleanupService;
  const testPrefix = `cleanup-test-${nanoid(6)}`;

  beforeAll(async () => {
    kit = await createDatabaseServiceTestKit([CleanupService]);
    prismaService = kit.prismaService;
    cleanupService = kit.module.get(CleanupService);
  });

  afterAll(async () => {
    await kit.close();
  });

  it('should delete orphaned tables', async () => {
    const tableVersionId = `${testPrefix}-table-${nanoid()}`;

    await prismaService.table.create({
      data: {
        versionId: tableVersionId,
        createdId: nanoid(),
        id: `${testPrefix}-orphaned-table`,
      },
    });

    const before = await prismaService.table.findUnique({
      where: { versionId: tableVersionId },
    });
    expect(before).toBeDefined();

    const result = await cleanupService.cleanOrphanedData();
    expect(result.tables).toBeGreaterThanOrEqual(1);

    const after = await prismaService.table.findUnique({
      where: { versionId: tableVersionId },
    });
    expect(after).toBeNull();
  });

  it('should delete orphaned rows', async () => {
    const rowVersionId = `${testPrefix}-row-${nanoid()}`;

    await prismaService.row.create({
      data: {
        versionId: rowVersionId,
        createdId: nanoid(),
        id: `${testPrefix}-orphaned-row`,
        data: {},
        hash: 'test-hash',
        schemaHash: 'test-schema-hash',
      },
    });

    const before = await prismaService.row.findUnique({
      where: { versionId: rowVersionId },
    });
    expect(before).toBeDefined();

    const result = await cleanupService.cleanOrphanedData();
    expect(result.rows).toBeGreaterThanOrEqual(1);

    const after = await prismaService.row.findUnique({
      where: { versionId: rowVersionId },
    });
    expect(after).toBeNull();
  });

  it('should not delete tables connected to revisions', async () => {
    const branchId = `${testPrefix}-branch-${nanoid()}`;
    const revisionId = `${testPrefix}-rev-${nanoid()}`;
    const tableVersionId = `${testPrefix}-connected-${nanoid()}`;

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
        id: `${testPrefix}-connected-table`,
        revisions: { connect: { id: revisionId } },
      },
    });

    await cleanupService.cleanOrphanedData();

    const table = await prismaService.table.findUnique({
      where: { versionId: tableVersionId },
    });
    expect(table).toBeDefined();
  });
});
