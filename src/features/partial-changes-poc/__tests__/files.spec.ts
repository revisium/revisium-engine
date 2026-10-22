import { num } from '@revisium/schema-toolkit/mocks';
import { ChangesScenario } from 'src/features/partial-changes-poc/__tests__/support/changes-scenario';
import { readDatabaseFootprint } from 'src/features/partial-changes-poc/__tests__/support/database-footprint';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import {
  documentSchema,
  emptyFile,
} from 'src/features/partial-changes-poc/__tests__/support/schemas';
import { guardCommittedVersions } from 'src/features/partial-changes-poc/__tests__/support/committed-versions-guard';

describe('file fields in partial commit and revert', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  guardCommittedVersions(() => kit.guard);

  afterEach(() => {
    jest.restoreAllMocks();
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

  describe('structure revert of a table with a file field', () => {
    function givenCommittedUpload() {
      return ChangesScenario.committed(
        kit,
        {
          docs: {
            schema: documentSchema,
            rows: { d1: { title: 'one', photo: emptyFile } },
          },
        },
        (draft) => draft.uploadFile('docs', 'd1', 'photo'),
      );
    }

    async function givenRenamedTableWithNewFieldAndTitleEdit() {
      const scenario = await givenCommittedUpload();
      await scenario.renameTable('docs', 'documents');
      await scenario.addField('documents', 'pages', num());
      await scenario.patchRow('documents', 'd1', { title: 'edited' });
      return scenario;
    }

    async function givenRemovedFileFieldAndTitleEdit() {
      const scenario = await givenCommittedUpload();
      await scenario.removeField('docs', 'photo');
      await scenario.patchRow('docs', 'd1', { title: 'edited' });
      return scenario;
    }

    async function revertedNativelyWithTitleEdit(
      given: () => Promise<ChangesScenario>,
    ) {
      const native = await given();
      await native.revertNatively();
      await native.patchRow('docs', 'd1', { title: 'edited' });
      return native;
    }

    it('reverts the structure of a renamed table and keeps the title edit with the Head file', async () => {
      const scenario = await givenRenamedTableWithNewFieldAndTitleEdit();
      const headPhoto = (await scenario.headRow('docs', 'd1')).data.photo;

      const result = await scenario.revert({ tables: ['documents'] });

      expect(result.status).toBe('applied');
      expect((await scenario.draftRow('docs', 'd1')).data).toEqual({
        title: 'edited',
        photo: headPhoto,
      });
    });

    it('links the file of a renamed table after its structure revert as a native revert and re-edit do', async () => {
      const scenario = await givenRenamedTableWithNewFieldAndTitleEdit();
      const native = await revertedNativelyWithTitleEdit(
        givenRenamedTableWithNewFieldAndTitleEdit,
      );

      await scenario.revert({ tables: ['documents'] });

      expect(await scenario.blobHashes('draft', 'docs', 'd1')).toEqual(
        await native.blobHashes('draft', 'docs', 'd1'),
      );
      expect(await scenario.blobHashes('draft', 'docs', 'd1')).toEqual(
        await scenario.blobHashes('head', 'docs', 'd1'),
      );
      expect(await scenario.projectFileBytes()).toBe(
        await native.projectFileBytes(),
      );
    });

    it('restores a removed file field with its Head file and keeps the title edit', async () => {
      const scenario = await givenRemovedFileFieldAndTitleEdit();
      const headPhoto = (await scenario.headRow('docs', 'd1')).data.photo;

      const result = await scenario.revert({ tables: ['docs'] });

      expect(result.status).toBe('applied');
      expect((await scenario.draftRow('docs', 'd1')).data).toEqual({
        title: 'edited',
        photo: headPhoto,
      });
    });

    it('links the restored file of a removed file field as a native revert and re-edit do', async () => {
      const scenario = await givenRemovedFileFieldAndTitleEdit();
      const native = await revertedNativelyWithTitleEdit(
        givenRemovedFileFieldAndTitleEdit,
      );

      await scenario.revert({ tables: ['docs'] });

      expect(await scenario.blobHashes('draft', 'docs', 'd1')).toEqual(
        await native.blobHashes('draft', 'docs', 'd1'),
      );
      expect(await scenario.blobHashes('draft', 'docs', 'd1')).toEqual(
        await scenario.blobHashes('head', 'docs', 'd1'),
      );
      expect(await scenario.projectFileBytes()).toBe(
        await native.projectFileBytes(),
      );
    });

    it('persists nothing, including file links, when a structure revert with a file field fails after its writes', async () => {
      const scenario = await givenRemovedFileFieldAndTitleEdit();
      const before = await readDatabaseFootprint(kit.prisma);
      jest
        .spyOn(kit.diffService, 'hasTableDiffs')
        .mockRejectedValueOnce(new Error('injected failure'));

      await expect(scenario.revert({ tables: ['docs'] })).rejects.toThrow(
        'injected failure',
      );

      expect(await readDatabaseFootprint(kit.prisma)).toEqual(before);
    });
  });

  it('persists nothing, including file links, when a commit of a file field fails after its writes', async () => {
    const scenario = await givenUploadAndTitleEdit();
    const before = await readDatabaseFootprint(kit.prisma);
    jest
      .spyOn(kit.diffService, 'hasTableDiffs')
      .mockRejectedValueOnce(new Error('injected failure'));

    await expect(scenario.commit({ fields: [photo] })).rejects.toThrow(
      'injected failure',
    );

    expect(await readDatabaseFootprint(kit.prisma)).toEqual(before);
  });
});
