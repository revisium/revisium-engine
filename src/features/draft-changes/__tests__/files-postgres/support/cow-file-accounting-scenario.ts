import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import { DraftRevisionApiService } from 'src/features/draft-revision/draft-revision-api.service';
import type { createNativeFileInitializationScenario } from './native-initialization-scenario';
import type { PrepareCandidateFilesResult } from 'src/features/draft-changes/queries/impl/prepare-candidate-files.query';

type NativeScenario = Awaited<
  ReturnType<typeof createNativeFileInitializationScenario>
>;
const EMPTY_FILE_BYTES = 0n;

export async function uploadNativeSource(scenario: NativeScenario) {
  const ready = await scenario.addAttachment();
  const uploaded = await scenario.uploadAttachment(String(ready.value.fileId));
  const blob = uploaded.row.fileBlobs[0];
  if (!blob) {
    throw new Error('Expected native upload blob association.');
  }
  return { uploaded, blob };
}

export async function tombstoneBlobAndResetUsage(
  scenario: NativeScenario,
  blobId: string,
) {
  await scenario.kit.prismaService.fileBlob.update({
    where: { id: blobId },
    data: { deletedAt: new Date() },
  });
  await scenario.kit.prismaService.projectFileUsage.update({
    where: { projectId: scenario.fixture.projectId },
    data: { fileBytes: 0n },
  });
}

export async function tombstoneBlob(
  scenario: NativeScenario,
  blobId: string,
  deletedAt = new Date('2026-01-02T03:04:05.000Z'),
): Promise<void> {
  await scenario.kit.prismaService.fileBlob.update({
    where: { id: blobId },
    data: { deletedAt },
  });
}

export async function tombstoneBlobAndSubtractUsage(
  scenario: NativeScenario,
  blobId: string,
  bytes: bigint,
): Promise<void> {
  await tombstoneBlob(scenario, blobId);
  await scenario.kit.prismaService.projectFileUsage.update({
    where: { projectId: scenario.fixture.projectId },
    data: { fileBytes: { decrement: bytes } },
  });
}

export async function assertBlobReactivatedOnce(
  scenario: NativeScenario,
  blobId: string,
  expectedBytes: bigint,
): Promise<void> {
  const blob = await scenario.kit.prismaService.fileBlob.findUnique({
    where: { id: blobId },
  });
  const usage = await scenario.kit.prismaService.projectFileUsage.findUnique({
    where: { projectId: scenario.fixture.projectId },
  });
  expect(blob?.deletedAt).toBeNull();
  expect(usage?.fileBytes).toBe(expectedBytes);
}

export async function assertTransactionalCleanupThenFail(
  scenario: NativeScenario,
  blobId: string,
  expectedCleanupIds: string[],
): Promise<never> {
  expect(expectedCleanupIds).toEqual([blobId]);
  const transaction = scenario.kit.transactionService.getTransaction();
  const blob = await transaction.fileBlob.findUniqueOrThrow({
    where: { id: blobId },
  });
  const usage = await transaction.projectFileUsage.findUniqueOrThrow({
    where: { projectId: scenario.fixture.projectId },
  });
  expect(blob.deletedAt).not.toBeNull();
  expect(usage.fileBytes).toBe(EMPTY_FILE_BYTES);
  throw new Error('force caller rollback after detached snapshot cleanup');
}

export async function assertReactivationAndCleanupThenFail(
  scenario: NativeScenario,
  reactivatedBlobId: string,
  detachedBlobId: string,
  cleanupBlobIds: string[],
  expectedBytes: bigint,
): Promise<never> {
  expect(cleanupBlobIds).toEqual([detachedBlobId]);
  const transaction = scenario.kit.transactionService.getTransaction();
  const reactivated = await transaction.fileBlob.findUniqueOrThrow({
    where: { id: reactivatedBlobId },
  });
  const detached = await transaction.fileBlob.findUniqueOrThrow({
    where: { id: detachedBlobId },
  });
  const usage = await transaction.projectFileUsage.findUniqueOrThrow({
    where: { projectId: scenario.fixture.projectId },
  });
  expect(reactivated.deletedAt).toBeNull();
  expect(detached.deletedAt).not.toBeNull();
  expect(usage.fileBytes).toBe(expectedBytes);
  throw new Error(
    'force caller rollback after reactivation and detached cleanup',
  );
}

export async function assertCleanupRolledBack(
  scenario: NativeScenario,
  blobId: string,
  expectedBytes: bigint,
  expectedRevisionFlags: Awaited<ReturnType<typeof branchRevisionFlags>>,
): Promise<void> {
  const blob = await scenario.kit.prismaService.fileBlob.findUniqueOrThrow({
    where: { id: blobId },
  });
  const usage =
    await scenario.kit.prismaService.projectFileUsage.findUniqueOrThrow({
      where: { projectId: scenario.fixture.projectId },
    });
  expect(blob.deletedAt).toBeNull();
  expect(usage.fileBytes).toBe(expectedBytes);
  expect(await branchRevisionFlags(scenario)).toEqual(expectedRevisionFlags);
}

export async function assertReactivationAndCleanupRolledBack(
  scenario: NativeScenario,
  reactivatedBlobId: string,
  detachedBlobId: string,
  expectedBytes: bigint,
  expectedRevisionFlags: Awaited<ReturnType<typeof branchRevisionFlags>>,
): Promise<void> {
  const transaction = scenario.kit.prismaService;
  const reactivated = await transaction.fileBlob.findUniqueOrThrow({
    where: { id: reactivatedBlobId },
  });
  const detached = await transaction.fileBlob.findUniqueOrThrow({
    where: { id: detachedBlobId },
  });
  const usage = await transaction.projectFileUsage.findUniqueOrThrow({
    where: { projectId: scenario.fixture.projectId },
  });
  const snapshot = await scenario.readSnapshot();
  const headRow = snapshot.head.tables
    .find(({ id }) => id === scenario.fixture.tableId)
    ?.rows.find(({ id }) => id === scenario.fixture.rowId);
  const draftRow = snapshot.draft.tables
    .find(({ id }) => id === scenario.fixture.tableId)
    ?.rows.find(({ id }) => id === scenario.fixture.rowId);
  expect(reactivated.deletedAt).not.toBeNull();
  expect(detached.deletedAt).toBeNull();
  expect(usage.fileBytes).toBe(expectedBytes);
  expect(headRow?.fileBlobs.map(({ id }) => id)).toContain(reactivatedBlobId);
  expect(draftRow?.fileBlobs.map(({ id }) => id)).toContain(detachedBlobId);
  expect(await branchRevisionFlags(scenario)).toEqual(expectedRevisionFlags);
}

export async function prepareHeadRetainedDraftDetachedCandidates(
  scenario: NativeScenario,
): Promise<Extract<PrepareCandidateFilesResult, { status: 'prepared' }>> {
  const snapshot = await scenario.readSnapshot();
  const draft = {
    tables: structuredClone(snapshot.draft.tables).map((table) => ({
      ...table,
      rows:
        table.id === scenario.fixture.tableId
          ? table.rows.filter(({ id }) => id !== scenario.fixture.rowId)
          : table.rows,
    })),
  } as DraftRevisionState;
  const result = await scenario.changes.prepareCandidateFiles({
    snapshot,
    head: { tables: snapshot.head.tables } as DraftRevisionState,
    draft,
  });
  if (result.status !== 'prepared') {
    throw new Error(
      `Expected prepared detached Draft state: ${result.blockers.map(({ code }) => code).join(', ')}`,
    );
  }
  return result;
}

export async function persistThroughCommitAndApply(
  scenario: NativeScenario,
  cleanupBlobIds: string[],
  afterApply?: (written: {
    headRevisionId: string;
    draftRevisionId: string;
    headState: DraftRevisionState;
    draftState: DraftRevisionState;
  }) => Promise<void>,
  prepared?: { head: DraftRevisionState; draft: DraftRevisionState },
) {
  const draftRevisionApi = scenario.kit.module.get(DraftRevisionApiService);
  const snapshot = await scenario.readSnapshot();
  return scenario.kit.transactionService.runSerializable(async () => {
    const headWrite = await draftRevisionApi.writeState({
      revisionId: scenario.fixture.draftRevisionId,
      candidate:
        prepared?.head ??
        ({ tables: snapshot.draft.tables } as DraftRevisionState),
      sources: {
        head: { tables: snapshot.head.tables } as DraftRevisionState,
        others: [{ tables: snapshot.draft.tables } as DraftRevisionState],
      },
    });
    const committed = await draftRevisionApi.commit({
      branchId: scenario.fixture.branchId,
      comment: 'Stage 8 file accounting fixture',
    });
    const committedSnapshot = await scenario.changes.readSnapshot({
      projectId: scenario.fixture.projectId,
      branchName: scenario.fixture.branchName,
    });
    const draftWrite = await draftRevisionApi.writeState({
      revisionId: committed.nextDraftRevisionId,
      candidate:
        prepared?.draft ??
        ({
          tables: committedSnapshot.draft.tables,
        } as DraftRevisionState),
      sources: {
        head: { tables: committedSnapshot.head.tables } as DraftRevisionState,
        others: [
          { tables: committedSnapshot.draft.tables } as DraftRevisionState,
        ],
      },
    });
    await scenario.changes.applyCandidateFiles({
      head: {
        revisionId: committed.previousDraftRevisionId,
        state: headWrite.state,
      },
      draft: {
        revisionId: committed.nextDraftRevisionId,
        state: draftWrite.state,
      },
      cleanupBlobIds,
    });
    const written = {
      headRevisionId: committed.previousDraftRevisionId,
      draftRevisionId: committed.nextDraftRevisionId,
      headState: headWrite.state,
      draftState: draftWrite.state,
    };
    await afterApply?.(written);
    return written;
  });
}

export async function persistDetachedSnapshotRowsAndApply(
  scenario: NativeScenario,
  afterApply?: (data: { cleanupBlobIds: string[] }) => Promise<void>,
  preparedOverride?: Extract<
    PrepareCandidateFilesResult,
    { status: 'prepared' }
  >,
) {
  const draftRevisionApi = scenario.kit.module.get(DraftRevisionApiService);
  const snapshot = await scenario.readSnapshot();
  const detached = (revision: typeof snapshot.head): DraftRevisionState =>
    ({
      tables: structuredClone(revision.tables).map((table) => ({
        ...table,
        rows:
          table.id === scenario.fixture.tableId
            ? table.rows.filter(({ id }) => id !== scenario.fixture.rowId)
            : table.rows,
      })),
    }) as DraftRevisionState;
  const prepared =
    preparedOverride ??
    (await scenario.changes.prepareCandidateFiles({
      snapshot,
      head: detached(snapshot.head),
      draft: detached(snapshot.draft),
    }));
  if (prepared.status !== 'prepared' || prepared.cleanupBlobIds.length === 0) {
    throw new Error(
      'Expected snapshot-derived cleanup after detaching the uploaded row.',
    );
  }
  const expectedCleanupBlobIds = [...prepared.cleanupBlobIds];
  const written = await scenario.kit.transactionService.runSerializable(
    async () => {
      const headWrite = await draftRevisionApi.writeState({
        revisionId: scenario.fixture.draftRevisionId,
        candidate: prepared.head,
        sources: {
          head: { tables: snapshot.head.tables } as DraftRevisionState,
          others: [{ tables: snapshot.draft.tables } as DraftRevisionState],
        },
      });
      const committed = await draftRevisionApi.commit({
        branchId: scenario.fixture.branchId,
        comment: 'Stage 8 detached file accounting fixture',
      });
      const committedSnapshot = await scenario.changes.readSnapshot({
        projectId: scenario.fixture.projectId,
        branchName: scenario.fixture.branchName,
      });
      const draftWrite = await draftRevisionApi.writeState({
        revisionId: committed.nextDraftRevisionId,
        candidate: prepared.draft,
        sources: {
          head: { tables: committedSnapshot.head.tables } as DraftRevisionState,
          others: [
            { tables: committedSnapshot.draft.tables } as DraftRevisionState,
          ],
        },
      });
      const detachedStateCleanup = await draftRevisionApi.cleanupDetachedState({
        states: [{ tables: snapshot.draft.tables } as DraftRevisionState],
      });
      const detachedBlobIds = new Set(detachedStateCleanup.affectedBlobIds);
      const cleanupBlobIds = expectedCleanupBlobIds.filter((id) =>
        detachedBlobIds.has(id),
      );
      if (cleanupBlobIds.length !== expectedCleanupBlobIds.length) {
        throw new Error(
          'Snapshot cleanup IDs were not detached by the caller writer.',
        );
      }
      await scenario.changes.applyCandidateFiles({
        head: {
          revisionId: committed.previousDraftRevisionId,
          state: headWrite.state,
        },
        draft: {
          revisionId: committed.nextDraftRevisionId,
          state: draftWrite.state,
        },
        cleanupBlobIds,
      });
      await afterApply?.({ cleanupBlobIds });
      return { cleanupBlobIds, headWrite, draftWrite };
    },
  );
  return written;
}

export async function branchRevisionFlags(scenario: NativeScenario) {
  const branch = await scenario.kit.prismaService.branch.findUniqueOrThrow({
    where: { id: scenario.fixture.branchId },
    include: {
      revisions: { select: { id: true, isHead: true, isDraft: true } },
    },
  });
  return branch.revisions;
}
