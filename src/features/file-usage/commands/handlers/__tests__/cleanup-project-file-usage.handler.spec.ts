import { nanoid } from 'nanoid';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { createDraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { CleanupProjectFileUsageCommand } from 'src/features/file-usage/commands/impl/cleanup-project-file-usage.command';
import { CleanupProjectFileUsageResult } from 'src/features/file-usage/types';
import {
  fakeSha256,
  givenBranchWithFileTable,
  setProjectFileBytes,
} from 'src/features/file-usage/commands/handlers/__tests__/utils';

describe('CleanupProjectFileUsageHandler', () => {
  let kit: DraftTestKit;

  beforeAll(async () => {
    kit = await createDraftTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  function execute(projectId: string): Promise<CleanupProjectFileUsageResult> {
    return kit.commandBus.execute(
      new CleanupProjectFileUsageCommand({ projectId }),
    );
  }

  it('tombstones every active blob in the project and drops the counter row', async () => {
    const scenario = await givenBranchWithFileTable(kit);
    const hashA = fakeSha256(`proj-cleanup-a-${nanoid()}`);
    const hashB = fakeSha256(`proj-cleanup-b-${nanoid()}`);

    await kit.prismaService.fileBlob.create({
      data: { projectId: scenario.projectId, hash: hashA, size: 100n },
    });
    await kit.prismaService.fileBlob.create({
      data: { projectId: scenario.projectId, hash: hashB, size: 200n },
    });
    await setProjectFileBytes(kit, scenario.projectId, 300n);

    const result = await execute(scenario.projectId);

    expect(result.blobsTombstoned).toBe(2);
    expect(result.bytesFreed).toBe(300n);
    expect(result.orphanHashes).toHaveLength(2);

    const active = await kit.prismaService.fileBlob.findMany({
      where: { projectId: scenario.projectId, deletedAt: null },
    });
    expect(active).toHaveLength(0);

    const tombstoned = await kit.prismaService.fileBlob.findMany({
      where: { projectId: scenario.projectId, deletedAt: { not: null } },
    });
    expect(tombstoned).toHaveLength(2);

    const usage = await kit.prismaService.projectFileUsage.findUnique({
      where: { projectId: scenario.projectId },
    });
    expect(usage).toBeNull();
  });

  it('excludes a hash from orphanHashes when another project has it active', async () => {
    const first = await givenBranchWithFileTable(kit);
    const second = await givenBranchWithFileTable(kit);
    const shared = fakeSha256(`proj-cleanup-shared-${nanoid()}`);

    await kit.prismaService.fileBlob.create({
      data: { projectId: first.projectId, hash: shared, size: 400n },
    });
    await kit.prismaService.fileBlob.create({
      data: { projectId: second.projectId, hash: shared, size: 400n },
    });
    await setProjectFileBytes(kit, first.projectId, 400n);
    await setProjectFileBytes(kit, second.projectId, 400n);

    const result = await execute(first.projectId);

    expect(result.orphanHashes).not.toContain(shared);
  });

  it('is a no-op when the project has no blobs and no counter row', async () => {
    const missingProjectId = `missing-${nanoid()}`;

    const result = await execute(missingProjectId);

    expect(result.projectId).toBe(missingProjectId);
    expect(result.blobsTombstoned).toBe(0);
    expect(result.bytesFreed).toBe(0n);
    expect(result.orphanHashes).toEqual([]);
  });
});
