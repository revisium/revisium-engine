import { nanoid } from 'nanoid';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { createDraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { ConfirmStorageDeletedCommand } from 'src/features/file-usage/commands/impl/confirm-storage-deleted.command';
import { ConfirmStorageDeletedResult } from 'src/features/file-usage/types';
import {
  fakeSha256,
  givenBranchWithFileTable,
} from 'src/features/file-usage/commands/handlers/__tests__/utils';

describe('ConfirmStorageDeletedHandler', () => {
  let kit: DraftTestKit;

  beforeAll(async () => {
    kit = await createDraftTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  function execute(
    hashes: readonly string[],
  ): Promise<ConfirmStorageDeletedResult> {
    return kit.commandBus.execute(new ConfirmStorageDeletedCommand({ hashes }));
  }

  it('hard-deletes tombstoned rows for the supplied hashes', async () => {
    const scenario = await givenBranchWithFileTable(kit);
    const hash = fakeSha256(`confirm-${nanoid()}`);

    const created = await kit.prismaService.fileBlob.create({
      data: {
        projectId: scenario.projectId,
        hash,
        size: 128n,
        deletedAt: new Date(),
      },
    });

    const result = await execute([hash]);

    expect(result.hashesConfirmed).toBe(1);
    expect(result.blobsDeleted).toBeGreaterThanOrEqual(1);

    const row = await kit.prismaService.fileBlob.findUnique({
      where: { id: created.id },
    });
    expect(row).toBeNull();
  });

  it('leaves active blobs untouched even when the hash matches', async () => {
    const scenario = await givenBranchWithFileTable(kit);
    const hash = fakeSha256(`confirm-safety-${nanoid()}`);

    const active = await kit.prismaService.fileBlob.create({
      data: { projectId: scenario.projectId, hash, size: 128n },
    });

    const result = await execute([hash]);

    expect(result.blobsDeleted).toBe(0);

    const row = await kit.prismaService.fileBlob.findUnique({
      where: { id: active.id },
    });
    expect(row).not.toBeNull();
    expect(row?.deletedAt).toBeNull();
  });

  it('returns a no-op result when the hash list is empty', async () => {
    const result = await execute([]);

    expect(result.hashesConfirmed).toBe(0);
    expect(result.blobsDeleted).toBe(0);
  });
});
