import { ChangesScenario } from 'src/features/partial-changes-poc/__tests__/support/changes-scenario';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import {
  documentSchema,
  emptyFile,
} from 'src/features/partial-changes-poc/__tests__/support/schemas';

describe('file fields in partial commit and revert', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  const photo = { tableId: 'documents', rowId: 'd1', path: '/photo' };

  async function givenUploadAndTitleEdit() {
    const scenario = await ChangesScenario.committed(kit, {
      documents: {
        schema: documentSchema,
        rows: { d1: { title: 'one', photo: emptyFile } },
      },
    });
    await scenario.uploadFile('documents', 'd1', 'photo');
    await scenario.patchRow('documents', 'd1', { title: 'edited' });
    return scenario;
  }

  it('commits the uploaded file field without the title edit', async () => {
    const scenario = await givenUploadAndTitleEdit();
    const uploaded = (await scenario.draftRow('documents', 'd1')).data.photo;
    const bytesBeforeCommit = await scenario.projectFileBytes();
    expect(bytesBeforeCommit).toBeGreaterThan(BigInt(0));

    const result = await scenario.commit({ fields: [photo] });

    expect(result.status).toBe('applied');
    const head = await scenario.headRow('documents', 'd1');
    expect(head.data).toEqual({ title: 'one', photo: uploaded });
    expect(await scenario.blobHashes('head', 'documents', 'd1')).toEqual([
      (uploaded as { hash: string }).hash,
    ]);
    expect(await scenario.projectFileBytes()).toBe(bytesBeforeCommit);
  });

  it('leaves blob links and project accounting as a native whole-Draft commit does', async () => {
    const partial = await givenUploadAndTitleEdit();
    const native = await givenUploadAndTitleEdit();

    await partial.commit({ fields: [photo] });
    await native.commitNatively();

    expect(await partial.blobHashes('head', 'documents', 'd1')).toEqual(
      await native.blobHashes('head', 'documents', 'd1'),
    );
    expect(await partial.projectFileBytes()).toBe(
      await native.projectFileBytes(),
    );
  });

  describe('revert of a replaced file', () => {
    async function givenReplacedFile() {
      const scenario = await ChangesScenario.committed(
        kit,
        {
          documents: {
            schema: documentSchema,
            rows: { d1: { title: 'one', photo: emptyFile } },
          },
        },
        (draft) => draft.uploadFile('documents', 'd1', 'photo'),
      );
      await scenario.updateRow('documents', 'd1', {
        title: 'edited',
        photo: emptyFile,
      });
      await scenario.uploadFile('documents', 'd1', 'photo', 'image');
      return scenario;
    }

    it('restores the Head file object and keeps the title edit', async () => {
      const scenario = await givenReplacedFile();
      const headPhoto = (await scenario.headRow('documents', 'd1')).data.photo;

      const result = await scenario.revert({ fields: [photo] });

      expect(result.status).toBe('applied');
      expect((await scenario.draftRow('documents', 'd1')).data).toEqual({
        title: 'edited',
        photo: headPhoto,
      });
    });

    it('links the restored blob without uploading and keeps project accounting', async () => {
      const scenario = await givenReplacedFile();
      const headBlobs = await scenario.blobHashes('head', 'documents', 'd1');
      const bytesBeforeRevert = await scenario.projectFileBytes();
      kit.storage.uploadFile.mockClear();

      await scenario.revert({ fields: [photo] });

      expect(kit.storage.uploadFile).not.toHaveBeenCalled();
      expect(await scenario.blobHashes('draft', 'documents', 'd1')).toEqual(
        headBlobs,
      );
      expect(await scenario.projectFileBytes()).toBe(bytesBeforeRevert);
    });
  });
});
