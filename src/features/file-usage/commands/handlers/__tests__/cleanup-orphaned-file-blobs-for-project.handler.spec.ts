import { nanoid } from 'nanoid';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { createDraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { CleanupOrphanedFileBlobsForProjectCommand } from 'src/features/file-usage/commands/impl/cleanup-orphaned-file-blobs-for-project.command';
import { CleanupOrphanedFileBlobsResult } from 'src/features/file-usage/types';
import {
  fakeSha256,
  givenBranchWithFileTable,
  setProjectFileBytes,
} from 'src/features/file-usage/commands/handlers/__tests__/utils';

describe('CleanupOrphanedFileBlobsForProjectHandler', () => {
  let kit: DraftTestKit;

  beforeAll(async () => {
    kit = await createDraftTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  function execute(projectId: string): Promise<CleanupOrphanedFileBlobsResult> {
    return kit.commandBus.execute(
      new CleanupOrphanedFileBlobsForProjectCommand({ projectId }),
    );
  }

  it('tombstones only blobs in the targeted project', async () => {
    const first = await givenBranchWithFileTable(kit);
    const second = await givenBranchWithFileTable(kit);
    const firstSize = 100n;
    const secondSize = 200n;

    await kit.prismaService.fileBlob.create({
      data: {
        projectId: first.projectId,
        hash: fakeSha256(`scoped-first-${nanoid()}`),
        size: firstSize,
      },
    });
    await kit.prismaService.fileBlob.create({
      data: {
        projectId: second.projectId,
        hash: fakeSha256(`scoped-second-${nanoid()}`),
        size: secondSize,
      },
    });
    await setProjectFileBytes(kit, first.projectId, firstSize);
    await setProjectFileBytes(kit, second.projectId, secondSize);

    const result = await execute(first.projectId);

    expect(result.blobsTombstoned).toBe(1);
    expect(result.bytesFreed).toBe(firstSize);

    const firstUsage = await kit.prismaService.projectFileUsage.findUnique({
      where: { projectId: first.projectId },
    });
    expect(firstUsage?.fileBytes).toBe(0n);

    const secondUsage = await kit.prismaService.projectFileUsage.findUnique({
      where: { projectId: second.projectId },
    });
    expect(secondUsage?.fileBytes).toBe(secondSize);
  });

  it('returns an empty result when the project has no orphans', async () => {
    const scenario = await givenBranchWithFileTable(kit);

    const result = await execute(scenario.projectId);

    expect(result.blobsTombstoned).toBe(0);
    expect(result.bytesFreed).toBe(0n);
    expect(result.orphanHashes).toEqual([]);
  });
});
