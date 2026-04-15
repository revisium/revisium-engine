import type { CowEngineE2eTestKit } from 'src/__tests__/e2e/engine-api-cow.e2e-helper';

export async function givenCowProductsProject(
  kit: CowEngineE2eTestKit,
): Promise<CowEngineE2eTestKit> {
  await kit.enableCowMode();
  await kit.seedProductsTable();

  return kit;
}

export async function givenCommittedCowProductsProject(
  kit: CowEngineE2eTestKit,
): Promise<CowEngineE2eTestKit> {
  await givenCowProductsProject(kit);

  const result = await kit.api.createRevision({
    projectId: kit.projectId,
    branchName: kit.branchName,
    comment: 'cow commit',
  });

  kit.committedRevisionId = result.previousDraftRevisionId;
  kit.draftRevisionId = await kit.refreshDraftRevisionId();

  return kit;
}
