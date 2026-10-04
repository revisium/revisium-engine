import { BadRequestException } from '@nestjs/common';
import { TransactionIsolationLevel } from 'src/engine-prisma-types';
import { createDraftChangesSnapshotTestKit } from './support/snapshot-scenario';
import { requiredRevisionRow } from './support/fingerprint-fixtures';

describe('DraftChanges snapshot transactions', () => {
  let kit: Awaited<ReturnType<typeof createDraftChangesSnapshotTestKit>>;

  beforeAll(async () => {
    kit = await createDraftChangesSnapshotTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  it('rejects ambient isolation weaker than RepeatableRead', async () => {
    const scenario = await kit.givenBranch();

    const read = scenario.readSnapshotInTransaction(
      TransactionIsolationLevel.ReadCommitted,
    );
    await expect(read).rejects.toBeInstanceOf(BadRequestException);
    await expect(read).rejects.toThrow(
      'Draft changes snapshots require RepeatableRead or Serializable isolation.',
    );
  });

  it('sees its own row write in a second RepeatableRead snapshot', async () => {
    const scenario = await kit.givenBranch();
    const ids = await scenario.seedState();

    const { first, second } = await scenario.readSnapshotAfterOwnRowUpdate(
      ids.draftRowVersionId,
      TransactionIsolationLevel.RepeatableRead,
    );

    expect(
      requiredRevisionRow(second.draft, ids.draftRowVersionId).data,
    ).toEqual({
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

  it('keeps a concurrent row update outside the captured RepeatableRead snapshot', async () => {
    const scenario = await kit.givenBranch();
    const ids = await scenario.seedState();

    const snapshot = await kit.readSnapshotDuringDraftRowUpdate(
      scenario,
      ids.draftRowVersionId,
    );

    expect(
      requiredRevisionRow(snapshot.draft, ids.draftRowVersionId).data,
    ).toEqual({
      nested: { value: 'draft' },
    });
  });
});
