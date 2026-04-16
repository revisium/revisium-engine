import {
  createCowEngineE2eTestKit,
  type CowEngineE2eTestKit,
} from './engine-api-cow.e2e-helper';
import {
  givenCommittedCowProductsProject,
  givenCowProductsProject,
} from 'src/__tests__/fixtures/scenarios/given-cow-products-project';

describe('EngineApi COW invariants E2E', () => {
  let kit: CowEngineE2eTestKit;

  it('materializes draft state for active draft tables', async () => {
    await givenCowProductsProject(kit);
    await kit.api.getRows({
      revisionId: kit.draftRevisionId,
      tableId: 'products',
      first: 10,
    });

    const cowDraftStates = await kit.prisma.cowDraftState.count({
      where: { branchId: kit.branchId },
    });

    expect(cowDraftStates).toBeGreaterThan(0);
  });

  it('writes committed snapshot state after createRevision', async () => {
    await givenCommittedCowProductsProject(kit);
    const committedRevisionId = kit.committedRevisionId;

    if (!committedRevisionId) {
      throw new Error('Committed revision id was not captured');
    }

    const snapshotCount = await kit.prisma.cowRevisionTableState.count({
      where: { revisionId: committedRevisionId },
    });

    expect(snapshotCount).toBeGreaterThan(0);
  });

  it('seeds draft state for a branch created from committed revision', async () => {
    await givenCommittedCowProductsProject(kit);
    const committedRevisionId = kit.committedRevisionId;

    if (!committedRevisionId) {
      throw new Error('Committed revision id was not captured');
    }

    const branch = await kit.api.createBranch({
      revisionId: committedRevisionId,
      branchName: 'cow-invariant-branch',
    });

    const childCowDraftStates = await kit.prisma.cowDraftState.count({
      where: { branchId: branch.id },
    });

    expect(childCowDraftStates).toBeGreaterThan(0);
  });

  it('cleans up orphaned draft materialization when draft state is rebuilt', async () => {
    await givenCowProductsProject(kit);

    await kit.api.getRows({
      revisionId: kit.draftRevisionId,
      tableId: 'products',
      first: 10,
    });
    const initialTableStates = await kit.prisma.cowTableState.count();
    const initialChunks = await kit.prisma.cowTableChunk.count();

    await kit.api.getRows({
      revisionId: kit.draftRevisionId,
      tableId: 'products',
      first: 10,
    });

    expect(await kit.prisma.cowTableState.count()).toBe(initialTableStates);
    expect(await kit.prisma.cowTableChunk.count()).toBe(initialChunks);
  });

  beforeEach(async () => {
    kit = await createCowEngineE2eTestKit();
  });

  afterEach(async () => {
    await kit.close();
  });
});
