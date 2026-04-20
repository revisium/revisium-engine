import { nanoid } from 'nanoid';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { createDraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { CleanupFileBlobsByIdsCommand } from 'src/features/file-usage/commands/impl/cleanup-file-blobs-by-ids.command';
import { CleanupOrphanedFileBlobsResult } from 'src/features/file-usage/types';
import {
  createRowDirect,
  fakeSha256,
  givenBranchWithFileTable,
  setProjectFileBytes,
} from 'src/features/file-usage/commands/handlers/__tests__/utils';

describe('CleanupFileBlobsByIdsHandler', () => {
  let kit: DraftTestKit;

  beforeAll(async () => {
    kit = await createDraftTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  function execute(
    projectId: string,
    blobIds: readonly string[],
  ): Promise<CleanupOrphanedFileBlobsResult> {
    return kit.commandBus.execute(
      new CleanupFileBlobsByIdsCommand({ projectId, blobIds }),
    );
  }

  it('tombstones only the supplied blob ids and leaves the rest untouched', async () => {
    const scenario = await givenBranchWithFileTable(kit);

    const targeted = await kit.prismaService.fileBlob.create({
      data: {
        projectId: scenario.projectId,
        hash: fakeSha256(`scoped-targeted-${nanoid()}`),
        size: 300n,
      },
    });
    const unrelated = await kit.prismaService.fileBlob.create({
      data: {
        projectId: scenario.projectId,
        hash: fakeSha256(`scoped-unrelated-${nanoid()}`),
        size: 400n,
      },
    });
    await setProjectFileBytes(kit, scenario.projectId, 700n);

    const result = await execute(scenario.projectId, [targeted.id]);

    expect(result.blobsTombstoned).toBe(1);
    expect(result.bytesFreed).toBe(300n);

    const tombstoned = await kit.prismaService.fileBlob.findUnique({
      where: { id: targeted.id },
    });
    expect(tombstoned?.deletedAt).not.toBeNull();

    const untouched = await kit.prismaService.fileBlob.findUnique({
      where: { id: unrelated.id },
    });
    expect(untouched?.deletedAt).toBeNull();

    const usage = await kit.prismaService.projectFileUsage.findUnique({
      where: { projectId: scenario.projectId },
    });
    expect(usage?.fileBytes).toBe(400n);
  });

  it('skips blobs that still have live row links', async () => {
    const scenario = await givenBranchWithFileTable(kit);

    const rowVersionId = await createRowDirect(kit, {
      draftTableVersionId: scenario.draftTableVersionId,
      rowId: `row-${nanoid()}`,
      data: {},
    });
    const linked = await kit.prismaService.fileBlob.create({
      data: {
        projectId: scenario.projectId,
        hash: fakeSha256(`scoped-linked-${nanoid()}`),
        size: 999n,
        rows: { connect: { versionId: rowVersionId } },
      },
    });
    await setProjectFileBytes(kit, scenario.projectId, 999n);

    const result = await execute(scenario.projectId, [linked.id]);

    expect(result.blobsTombstoned).toBe(0);
    expect(result.bytesFreed).toBe(0n);

    const row = await kit.prismaService.fileBlob.findUnique({
      where: { id: linked.id },
    });
    expect(row?.deletedAt).toBeNull();
  });

  it('returns an empty result when blobIds is empty', async () => {
    const scenario = await givenBranchWithFileTable(kit);

    const result = await execute(scenario.projectId, []);

    expect(result.blobsTombstoned).toBe(0);
    expect(result.bytesFreed).toBe(0n);
    expect(result.orphanHashes).toEqual([]);
  });
});
