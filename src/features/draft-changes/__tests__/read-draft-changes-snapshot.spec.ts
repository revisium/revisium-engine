import { nanoid } from 'nanoid';
import { TransactionIsolationLevel } from 'src/engine-prisma-types';
import { MigrationStatus } from 'src/features/migration/types/migration.types';
import { createDraftChangesSnapshotTestKit } from './support/snapshot-test-kit';

describe('DraftChangesApiService.readSnapshot', () => {
  let kit: Awaited<ReturnType<typeof createDraftChangesSnapshotTestKit>>;

  beforeAll(async () => {
    kit = await createDraftChangesSnapshotTestKit();
  });

  afterAll(async () => kit.close());

  it('returns the persisted branch, Head, Draft, system tables, rows and file records', async () => {
    const scenario = await kit.givenBranch();
    const ids = await scenario.seedState();

    const snapshot = await scenario.readSnapshot();

    expect(snapshot.branch).toMatchObject({
      id: scenario.branch.branchId,
      projectId: scenario.branch.projectId,
      name: scenario.branch.branchName,
    });
    expect(snapshot.branch).toEqual(await scenario.readBranch());
    expect(snapshot.head).toMatchObject({
      id: scenario.branch.headRevisionId,
      isHead: true,
      branchId: scenario.branch.branchId,
    });
    expect(snapshot.draft).toMatchObject({
      id: scenario.branch.draftRevisionId,
      isDraft: true,
      parentId: scenario.branch.headRevisionId,
    });
    expect(snapshot.head.tables.some(({ system }) => system)).toBe(true);
    expect(snapshot.draft.tables.some(({ system }) => system)).toBe(true);
    const draftTable = snapshot.draft.tables.find(
      ({ id }) => id === 'products',
    );
    expect(draftTable?.rows[0]).toMatchObject({
      versionId: ids.draftRowVersionId,
      data: { nested: { value: 'draft' } },
      meta: { source: 'draft' },
    });
    expect(draftTable?.rows[0]?.fileBlobs[0]).toMatchObject({
      id: ids.blobId,
      projectId: scenario.branch.projectId,
      size: BigInt(7),
      deletedAt: null,
    });
    expect(snapshot.head).toEqual(
      await scenario.readPersistedRevision(scenario.branch.headRevisionId),
    );
    expect(snapshot.draft).toEqual(
      await scenario.readPersistedRevision(scenario.branch.draftRevisionId),
    );
    expect(snapshot.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects a branch that does not exist', async () => {
    const before = await kit.databaseInventory();
    await expect(
      kit.draftChangesApi.readSnapshot({
        projectId: nanoid(),
        branchName: 'missing',
      }),
    ).rejects.toThrow();
    expect(await kit.databaseInventory()).toEqual(before);
  });

  it('rejects a branch with no Head role', async () => {
    const scenario = await kit.givenBranch();
    await scenario.removeHeadRole();

    await expect(scenario.readSnapshot()).rejects.toThrow();
  });

  it('rejects ambiguous Head roles', async () => {
    const scenario = await kit.givenBranch();
    await scenario.markDraftAsHead();

    await expect(scenario.readSnapshot()).rejects.toThrow();
  });

  it('rejects a branch with no Draft role', async () => {
    const scenario = await kit.givenBranch();
    await scenario.removeDraftRole();

    await expect(scenario.readSnapshot()).rejects.toThrow();
  });

  it('rejects ambiguous Draft roles', async () => {
    const scenario = await kit.givenBranch();
    await scenario.markHeadAsDraft();

    await expect(scenario.readSnapshot()).rejects.toThrow();
  });

  it('rejects one revision claiming both Head and Draft roles', async () => {
    const scenario = await kit.givenBranch();
    await scenario.markHeadAlsoDraft();

    await expect(scenario.readSnapshot()).rejects.toThrow();
  });

  it('rejects a Draft whose parent is not its branch Head', async () => {
    const scenario = await kit.givenBranch();
    await scenario.removeDraftParent();

    await expect(scenario.readSnapshot()).rejects.toThrow();
  });

  it('does not write while capturing a snapshot', async () => {
    const scenario = await kit.givenBranch();
    await scenario.seedState();
    const before = await scenario.readPersistedState();

    await scenario.readSnapshot();

    expect(await scenario.readPersistedState()).toEqual(before);
  });

  it.each([
    MigrationStatus.PENDING,
    MigrationStatus.COPYING,
    MigrationStatus.SWAPPING,
  ])('blocks snapshot reads during %s migration', async (status) => {
    const scenario = await kit.givenBranch();
    await scenario.createMigration(status);
    const before = await scenario.readPersistedState();

    await expect(scenario.readSnapshot()).rejects.toThrow();
    expect(await scenario.readPersistedState()).toEqual(before);
  });

  it.each([
    MigrationStatus.COMPLETED,
    MigrationStatus.FAILED,
    MigrationStatus.CANCELLED,
  ])('allows a fresh snapshot after %s migration', async (status) => {
    const scenario = await kit.givenBranch();
    await scenario.seedState();
    await scenario.createMigration(status);

    expect((await scenario.readSnapshot()).branch.id).toBe(
      scenario.branch.branchId,
    );
  });

  it('observes an active migration created in the caller transaction', async () => {
    const scenario = await kit.givenBranch();

    await expect(
      scenario.readSnapshotAfterUncommittedMigration(MigrationStatus.PENDING),
    ).rejects.toThrow();
  });

  it('observes a terminal migration changed to active in the caller transaction', async () => {
    const scenario = await kit.givenBranch();
    const migration = await scenario.createMigration(MigrationStatus.COMPLETED);

    await expect(
      scenario.transitionMigrationAndReadSnapshot(
        migration.id,
        MigrationStatus.PENDING,
      ),
    ).rejects.toThrow();
  });

  it('rejects a caller transaction weaker than RepeatableRead', async () => {
    const scenario = await kit.givenBranch();

    await expect(
      kit.transactionService.run(() => scenario.readSnapshot(), {
        isolationLevel: TransactionIsolationLevel.ReadCommitted,
      }),
    ).rejects.toThrow();
  });

  it('reflects its own intervening row write on a second read in one transaction', async () => {
    const scenario = await kit.givenBranch();
    const ids = await scenario.seedState();

    const { first, second } = await scenario.readSnapshotAfterOwnRowUpdate(
      ids.draftRowVersionId,
      TransactionIsolationLevel.RepeatableRead,
    );
    const draftRow = second.draft.tables
      .flatMap(({ rows }) => rows)
      .find(({ versionId }) => versionId === ids.draftRowVersionId);
    expect(draftRow?.data).toEqual({
      nested: { value: 'written in transaction' },
    });
    expect(second.fingerprint).not.toBe(first.fingerprint);
  });

  it('reuses an ambient Serializable transaction', async () => {
    const scenario = await kit.givenBranch();
    const ids = await scenario.seedState();

    const { first, second } = await scenario.readSnapshotAfterOwnRowUpdate(
      ids.draftRowVersionId,
      TransactionIsolationLevel.Serializable,
    );

    expect(second.fingerprint).not.toBe(first.fingerprint);
  });

  it('keeps a concurrent row update outside the captured transaction snapshot', async () => {
    const scenario = await kit.givenBranch();
    const ids = await scenario.seedState();

    const snapshot = await kit.readSnapshotDuringDraftRowUpdate(
      scenario,
      ids.draftRowVersionId,
    );

    const draftRow = snapshot.draft.tables
      .flatMap(({ rows }) => rows)
      .find(({ versionId }) => versionId === ids.draftRowVersionId);
    expect(draftRow?.data).toEqual({ nested: { value: 'draft' } });
  });
});
