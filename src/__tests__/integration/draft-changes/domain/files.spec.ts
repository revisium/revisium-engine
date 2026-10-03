import { givenRemovedFile } from '../support/file-scenarios';
import { include } from '../support/select';
import { useChangesTestKit } from '../support/test-kit';

describe.skip('Draft Changes: files', () => {
  const kit = useChangesTestKit();

  it('restores the original uploaded file value', async () => {
    const { f, uploaded } = await givenRemovedFile(kit());
    await f.discardFields('/attachment');
    expect((await f.draftRow())?.attachment).toMatchObject({
      fileId: uploaded.fileId,
      hash: uploaded.hash,
    });
  });

  it('reconnects the original immutable blob', async () => {
    const file = await givenRemovedFile(kit());
    await file.f.discardFields('/attachment');
    expect(await file.draftBlobIds()).toContain(file.blobId);
  });

  it('restores a deleted blob to live status', async () => {
    const file = await givenRemovedFile(kit());
    await file.f.discardFields('/attachment');
    expect((await file.blob()).deletedAt).toBeNull();
  });

  it('restores project storage accounting', async () => {
    const file = await givenRemovedFile(kit());
    await file.f.discardFields('/attachment');
    expect((await file.usage()).fileBytes).toBe(BigInt(file.uploaded.size));
  });

  it('does not upload the restored file again', async () => {
    const file = await givenRemovedFile(kit());
    await file.f.discardFields('/attachment');
    expect(file.storage.uploadFile).not.toHaveBeenCalled();
  });

  it('preserves an independent caption edit', async () => {
    const { f } = await givenRemovedFile(kit());
    await f.discardFields('/attachment');
    expect((await f.draftRow())?.caption).toBe('draft');
  });

  it('blocks selection inside an atomic file value', async () => {
    const { f } = await givenRemovedFile(kit());
    expect(
      (await f.plan('discard', include(f.fields('/attachment/fileId')))).status,
    ).toBe('blocked');
  });
});
