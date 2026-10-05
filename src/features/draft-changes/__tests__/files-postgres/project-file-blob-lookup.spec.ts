import { createNativeFileInitializationScenario } from './support/native-initialization-scenario';
import { tombstoneBlob } from './support/cow-file-accounting-scenario';

describe('Draft Changes files: canonical project blob lookup', () => {
  it('returns canonical blob identity and metadata for an uploaded source', async () => {
    const scenario = await createNativeFileInitializationScenario();
    try {
      const ready = await scenario.addAttachment();
      const uploaded = await scenario.uploadAttachment(
        String(ready.value.fileId),
      );
      const hash = String(uploaded.value.hash);

      const records = await scenario.kit.fileUsageApi.getProjectFileBlobs({
        projectId: scenario.fixture.projectId,
        hashes: [hash, 'missing-hash'],
      });

      expect(records).toEqual([
        expect.objectContaining({
          id: uploaded.row.fileBlobs[0]?.id,
          hash,
          size: BigInt(uploaded.value.size as number),
          deletedAt: null,
        }),
      ]);
    } finally {
      await scenario.close();
    }
  });

  it('returns matching tombstones so immutable sources can be inspected', async () => {
    const scenario = await createNativeFileInitializationScenario();
    try {
      const ready = await scenario.addAttachment();
      const uploaded = await scenario.uploadAttachment(
        String(ready.value.fileId),
      );
      const hash = String(uploaded.value.hash);
      const sourceBlob = uploaded.row.fileBlobs[0];
      if (!sourceBlob) {
        throw new Error('Expected native upload blob relation.');
      }
      const deletedAt = new Date('2026-01-02T03:04:05.000Z');
      await tombstoneBlob(scenario, sourceBlob.id, deletedAt);

      const records = await scenario.kit.fileUsageApi.getProjectFileBlobs({
        projectId: scenario.fixture.projectId,
        hashes: [hash],
      });

      expect(records).toEqual([
        expect.objectContaining({
          id: sourceBlob.id,
          hash,
          deletedAt,
        }),
      ]);
    } finally {
      await scenario.close();
    }
  });

  it('keeps same-hash records scoped to the requested project and hashes', async () => {
    const scenario = await createNativeFileInitializationScenario();
    const foreignScenario = await createNativeFileInitializationScenario();
    try {
      const ready = await scenario.addAttachment();
      const uploaded = await scenario.uploadAttachment(
        String(ready.value.fileId),
      );
      const foreignReady = await foreignScenario.addAttachment();
      const foreignUploaded = await foreignScenario.uploadAttachment(
        String(foreignReady.value.fileId),
      );
      const hash = String(uploaded.value.hash);
      expect(foreignUploaded.value.hash).toBe(hash);

      const records = await scenario.kit.fileUsageApi.getProjectFileBlobs({
        projectId: scenario.fixture.projectId,
        hashes: [hash, 'not-present-in-this-project'],
      });

      expect(records.map(({ id }) => id)).toEqual([
        uploaded.row.fileBlobs[0]?.id,
      ]);
      expect(records.map(({ hash: recordHash }) => recordHash)).toEqual([hash]);
    } finally {
      await scenario.close();
      await foreignScenario.close();
    }
  });
});
