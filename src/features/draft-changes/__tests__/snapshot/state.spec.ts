import { nanoid } from 'nanoid';
import { NotFoundException } from '@nestjs/common';
import { createDraftChangesSnapshotTestKit } from './support/snapshot-scenario';
import {
  requiredRevisionRow,
  requiredRevisionTable,
  requiredSystemTable,
} from './support/fingerprint-fixtures';

describe('DraftChanges snapshot state', () => {
  let kit: Awaited<ReturnType<typeof createDraftChangesSnapshotTestKit>>;

  beforeAll(async () => {
    kit = await createDraftChangesSnapshotTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  it('returns the persisted branch, Head, Draft, tables, rows and file records', async () => {
    const scenario = await kit.givenBranch();
    const ids = await scenario.seedState();

    const snapshot = await scenario.readSnapshot();

    expect(snapshot.branch).toEqual(await scenario.readBranch());
    expect(snapshot.branch).toMatchObject({
      id: scenario.branch.branchId,
      projectId: scenario.branch.projectId,
      name: scenario.branch.branchName,
    });
    expect(snapshot.head).toEqual(
      await scenario.readPersistedRevision(scenario.branch.headRevisionId),
    );
    expect(snapshot.draft).toEqual(
      await scenario.readPersistedRevision(scenario.branch.draftRevisionId),
    );
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
    expect(requiredSystemTable(snapshot.head).system).toBe(true);
    expect(requiredSystemTable(snapshot.draft).system).toBe(true);
    expect(requiredRevisionTable(snapshot.head, 'products').readonly).toBe(
      true,
    );
    expect(requiredRevisionTable(snapshot.draft, 'products').readonly).toBe(
      false,
    );
    expect(
      requiredRevisionRow(snapshot.head, ids.headRowVersionId).readonly,
    ).toBe(true);
    expect(
      requiredRevisionRow(snapshot.draft, ids.draftRowVersionId),
    ).toMatchObject({
      data: { nested: { value: 'draft' } },
      meta: { source: 'draft' },
    });
    expect(
      requiredRevisionRow(snapshot.draft, ids.draftRowVersionId).fileBlobs[0],
    ).toMatchObject({
      id: ids.blobId,
      projectId: scenario.branch.projectId,
      size: BigInt(7),
      deletedAt: null,
    });
    expect(snapshot.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects an unknown branch without changing persisted state', async () => {
    const scenario = await kit.givenBranch();
    const before = await scenario.databaseInventory();

    await expect(
      scenario.readSnapshotAt({ projectId: nanoid(), branchName: 'missing' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(await scenario.databaseInventory()).toEqual(before);
  });

  it('does not write while capturing a snapshot', async () => {
    const scenario = await kit.givenBranch();
    await scenario.seedState();
    const before = await scenario.readPersistedState();

    await scenario.readSnapshot();

    expect(await scenario.readPersistedState()).toEqual(before);
  });
});
