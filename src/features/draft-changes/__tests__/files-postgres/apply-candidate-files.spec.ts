import { createNativeFileInitializationScenario } from './support/native-initialization-scenario';
import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import {
  persistThroughCommitAndApply,
  persistDetachedSnapshotRowsAndApply,
  branchRevisionFlags,
  tombstoneBlobAndResetUsage,
  uploadNativeSource,
  assertBlobReactivatedOnce,
  assertReactivationAndCleanupRolledBack,
  assertReactivationAndCleanupThenFail,
  prepareHeadRetainedDraftDetachedCandidates,
  tombstoneBlobAndSubtractUsage,
} from './support/cow-file-accounting-scenario';

describe('Draft Changes files: apply after COW state writes', () => {
  it('requires the caller transaction before applying saved candidate states', async () => {
    const scenario = await createNativeFileInitializationScenario();
    try {
      const snapshot = await scenario.readSnapshot();

      await expect(
        scenario.changes.applyCandidateFiles({
          head: {
            revisionId: scenario.fixture.headRevisionId,
            state: { tables: snapshot.head.tables } as DraftRevisionState,
          },
          draft: {
            revisionId: scenario.fixture.draftRevisionId,
            state: { tables: snapshot.draft.tables } as DraftRevisionState,
          },
          cleanupBlobIds: [],
        }),
      ).rejects.toThrow();
    } finally {
      await scenario.close();
    }
  });

  it('reactivates a reused tombstoned blob once for both saved outputs', async () => {
    const scenario = await createNativeFileInitializationScenario();
    try {
      const { uploaded, blob } = await uploadNativeSource(scenario);
      await tombstoneBlobAndResetUsage(scenario, blob.id);
      const snapshot = await scenario.readSnapshot();
      const prepared = await scenario.changes.prepareCandidateFiles({
        snapshot,
        head: { tables: snapshot.draft.tables } as DraftRevisionState,
        draft: { tables: snapshot.draft.tables } as DraftRevisionState,
      });
      expect(prepared.status).toBe('prepared');
      if (prepared.status !== 'prepared') {
        throw new Error('Expected tombstoned source preparation.');
      }

      await persistThroughCommitAndApply(
        scenario,
        [],
        async (written) => {
          expect(
            written.headState.tables
              .flatMap((table) => table.rows)
              .flatMap((row) => row.fileBlobs.map(({ id }) => id)),
          ).toContain(blob.id);
          expect(
            written.draftState.tables
              .flatMap((table) => table.rows)
              .flatMap((row) => row.fileBlobs.map(({ id }) => id)),
          ).toContain(blob.id);
        },
        prepared,
      );

      await assertBlobReactivatedOnce(
        scenario,
        blob.id,
        BigInt(uploaded.value.size as number),
      );
    } finally {
      await scenario.close();
    }
  });

  it('rolls back reused-blob reactivation and exclusive Draft cleanup together', async () => {
    const scenario = await createNativeFileInitializationScenario();
    try {
      const ready = await scenario.addAttachment();
      const headUpload = await scenario.uploadAttachment(
        String(ready.value.fileId),
      );
      const headBlob = headUpload.row.fileBlobs[0];
      if (!headBlob) {
        throw new Error('Expected Head upload blob.');
      }
      await scenario.promoteCurrentDraftToHead();
      const draftUpload = await scenario.uploadFileAtPath(
        String(ready.value.fileId),
        'attachment',
        'different Draft bytes',
      );
      const draftBlob = draftUpload.row.fileBlobs[0];
      if (!draftBlob) {
        throw new Error('Expected Draft upload blob.');
      }
      expect(draftBlob.id).not.toBe(headBlob.id);
      const prepared =
        await prepareHeadRetainedDraftDetachedCandidates(scenario);
      expect(prepared.cleanupBlobIds).toEqual([draftBlob.id]);
      await tombstoneBlobAndSubtractUsage(
        scenario,
        headBlob.id,
        BigInt(headUpload.value.size as number),
      );
      const originalRevisions = await branchRevisionFlags(scenario);

      await expect(
        persistDetachedSnapshotRowsAndApply(
          scenario,
          async ({ cleanupBlobIds }) => {
            return assertReactivationAndCleanupThenFail(
              scenario,
              headBlob.id,
              draftBlob.id,
              cleanupBlobIds,
              BigInt(headUpload.value.size as number),
            );
          },
          prepared,
        ),
      ).rejects.toThrow(
        'force caller rollback after reactivation and detached cleanup',
      );

      await assertReactivationAndCleanupRolledBack(
        scenario,
        headBlob.id,
        draftBlob.id,
        BigInt(draftUpload.value.size as number),
        originalRevisions,
      );
    } finally {
      await scenario.close();
    }
  });
});
