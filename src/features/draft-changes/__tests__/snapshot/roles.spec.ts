import { BadRequestException } from '@nestjs/common';
import { createDraftChangesSnapshotTestKit } from './support/snapshot-scenario';

describe('DraftChanges snapshot revision roles', () => {
  let kit: Awaited<ReturnType<typeof createDraftChangesSnapshotTestKit>>;

  beforeAll(async () => {
    kit = await createDraftChangesSnapshotTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  it('requires a Head role', async () => {
    const scenario = await kit.givenBranch();
    await scenario.removeHeadRole();

    await expectBadRequest(
      scenario.readSnapshot(),
      'Branch must have exactly one Head and one Draft revision.',
    );
  });

  it('requires exactly one Head role', async () => {
    const scenario = await kit.givenBranch();
    await scenario.markDraftAsHead();

    await expectBadRequest(
      scenario.readSnapshot(),
      'Branch must have exactly one Head and one Draft revision.',
    );
  });

  it('requires a Draft role', async () => {
    const scenario = await kit.givenBranch();
    await scenario.removeDraftRole();

    await expectBadRequest(
      scenario.readSnapshot(),
      'Branch must have exactly one Head and one Draft revision.',
    );
  });

  it('requires exactly one Draft role', async () => {
    const scenario = await kit.givenBranch();
    await scenario.markHeadAsDraft();

    await expectBadRequest(
      scenario.readSnapshot(),
      'Branch must have exactly one Head and one Draft revision.',
    );
  });

  it('requires distinct Head and Draft revisions', async () => {
    const scenario = await kit.givenBranch();
    await scenario.markHeadAlsoDraft();

    await expectBadRequest(
      scenario.readSnapshot(),
      'Head and Draft must be distinct revisions.',
    );
  });

  it('requires the Draft parent to be the branch Head', async () => {
    const scenario = await kit.givenBranch();
    await scenario.removeDraftParent();

    await expectBadRequest(
      scenario.readSnapshot(),
      'Draft must have its branch Head as its parent.',
    );
  });
});

async function expectBadRequest(
  action: Promise<unknown>,
  message: string,
): Promise<void> {
  await expect(action).rejects.toBeInstanceOf(BadRequestException);
  await expect(action).rejects.toThrow(message);
}
