import { nanoid } from 'nanoid';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { createDraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { CleanupOrphanedFileBlobsCommand } from 'src/features/file-usage/commands/impl/cleanup-orphaned-file-blobs.command';
import { CleanupOrphanedFileBlobsResult } from 'src/features/file-usage/types';
import {
  createRowDirect,
  fakeSha256,
  givenBranchWithFileTable,
  setProjectFileBytes,
} from 'src/features/file-usage/commands/handlers/__tests__/utils';

describe('CleanupOrphanedFileBlobsHandler', () => {
  let kit: DraftTestKit;

  beforeAll(async () => {
    kit = await createDraftTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  function execute(): Promise<CleanupOrphanedFileBlobsResult> {
    return kit.commandBus.execute(new CleanupOrphanedFileBlobsCommand());
  }

  it('tombstones orphan FileBlob rows and preserves them in the table', async () => {
    const scenario = await givenBranchWithFileTable(kit);
    const hash = fakeSha256(`tombstone-${nanoid()}`);
    const size = 256n;

    const created = await kit.prismaService.fileBlob.create({
      data: { projectId: scenario.projectId, hash, size },
    });
    await setProjectFileBytes(kit, scenario.projectId, size);

    const result = await execute();

    expect(result.blobsTombstoned).toBeGreaterThanOrEqual(1);
    expect(result.orphanHashes).toContain(hash);

    const persisted = await kit.prismaService.fileBlob.findUnique({
      where: { id: created.id },
    });
    expect(persisted).not.toBeNull();
    expect(persisted?.deletedAt).not.toBeNull();
  });

  it('decrements Project counter by the freed bytes', async () => {
    const scenario = await givenBranchWithFileTable(kit);
    const hash = fakeSha256(`decrement-${nanoid()}`);
    const size = 512n;

    await kit.prismaService.fileBlob.create({
      data: { projectId: scenario.projectId, hash, size },
    });
    await setProjectFileBytes(kit, scenario.projectId, size);

    await execute();

    const usage = await kit.prismaService.projectFileUsage.findUnique({
      where: { projectId: scenario.projectId },
    });
    expect(usage?.fileBytes).toBe(0n);
  });

  it('excludes from orphanHashes any hash that still has an active blob elsewhere', async () => {
    const first = await givenBranchWithFileTable(kit);
    const second = await givenBranchWithFileTable(kit);
    const shared = fakeSha256(`shared-${nanoid()}`);

    await kit.prismaService.fileBlob.create({
      data: { projectId: first.projectId, hash: shared, size: 100n },
    });

    const rowVersionId = await createRowDirect(kit, {
      draftTableVersionId: second.draftTableVersionId,
      rowId: `row-${nanoid()}`,
      data: {},
    });
    await kit.prismaService.fileBlob.create({
      data: {
        projectId: second.projectId,
        hash: shared,
        size: 100n,
        rows: { connect: { versionId: rowVersionId } },
      },
    });

    const result = await execute();

    expect(result.orphanHashes).not.toContain(shared);
  });

  it('returns an empty result when there are no orphans', async () => {
    await kit.prismaService.fileBlob.updateMany({
      where: { deletedAt: null },
      data: { deletedAt: new Date() },
    });

    const result = await execute();

    expect(result.blobsTombstoned).toBe(0);
    expect(result.bytesFreed).toBe(0n);
    expect(result.orphanHashes).toEqual([]);
  });
});
