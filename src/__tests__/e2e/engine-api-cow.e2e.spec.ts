import { Prisma } from 'src/__generated__/client';
import {
  createCowEngineE2eTestKit,
  type CowEngineE2eTestKit,
} from './engine-api-cow.e2e-helper';
import {
  givenCommittedCowProductsProject,
  givenCowProductsProject,
} from 'src/__tests__/fixtures/scenarios/given-cow-products-project';

describe('EngineApi COW E2E', () => {
  let kit: CowEngineE2eTestKit;

  it('reads draft rows through COW state with json filter and ordering', async () => {
    await givenCowProductsProject(kit);

    const filtered = await kit.api.getRows({
      revisionId: kit.draftRevisionId,
      tableId: 'products',
      first: 10,
      where: { data: { path: 'name', equals: 'Apple' } },
    });

    expect(filtered.edges).toHaveLength(1);
    expect(filtered.edges[0]?.node.id).toBe('row-apple');

    const ordered = await kit.api.getRows({
      revisionId: kit.draftRevisionId,
      tableId: 'products',
      first: 10,
      orderBy: [{ data: { path: 'name', direction: 'asc' } }],
    });

    expect(ordered.edges.map((edge) => edge.node.id)).toEqual([
      'row-apple',
      'row-banana',
    ]);
  });

  it('commits through current engine and snapshots committed state into COW', async () => {
    await givenCommittedCowProductsProject(kit);
    const committedRevisionId = kit.committedRevisionId;

    if (!committedRevisionId) {
      throw new Error('Committed revision id was not captured');
    }

    const committedRows = await kit.api.getRows({
      revisionId: committedRevisionId,
      tableId: 'products',
      first: 10,
      orderBy: [{ data: { path: 'name', direction: 'asc' } }],
    });

    expect(committedRows.edges.map((edge) => edge.node.id)).toEqual([
      'row-apple',
      'row-banana',
    ]);
  });

  it('creates a branch from committed revision and seeds COW branch state', async () => {
    await givenCommittedCowProductsProject(kit);
    const committedRevisionId = kit.committedRevisionId;

    if (!committedRevisionId) {
      throw new Error('Committed revision id was not captured');
    }

    const branch = await kit.api.createBranch({
      revisionId: committedRevisionId,
      branchName: 'cow-feature-branch',
    });

    const childDraft = await kit.api.getDraftRevision(branch.id);
    const rows = await kit.api.getRows({
      revisionId: childDraft.id,
      tableId: 'products',
      first: 10,
      orderBy: [{ data: { path: 'name', direction: 'asc' } }],
    });

    expect(rows.edges.map((edge) => edge.node.id)).toEqual([
      'row-apple',
      'row-banana',
    ]);
  });

  it('reverts draft changes and refreshes draft COW state', async () => {
    await givenCommittedCowProductsProject(kit);

    await kit.api.createRow({
      revisionId: kit.draftRevisionId,
      tableId: 'products',
      rowId: 'row-cherry',
      data: {
        name: 'Cherry',
        price: 30,
      } as Prisma.InputJsonValue,
    });

    const withCherry = await kit.api.getRows({
      revisionId: kit.draftRevisionId,
      tableId: 'products',
      first: 10,
      where: { data: { path: 'name', equals: 'Cherry' } },
    });
    expect(withCherry.edges).toHaveLength(1);

    await kit.api.revertChanges({
      projectId: kit.projectId,
      branchName: kit.branchName,
    });
    kit.draftRevisionId = await kit.refreshDraftRevisionId();

    const afterRevert = await kit.api.getRows({
      revisionId: kit.draftRevisionId,
      tableId: 'products',
      first: 10,
      where: { data: { path: 'name', equals: 'Cherry' } },
    });
    expect(afterRevert.edges).toHaveLength(0);
  });

  beforeEach(async () => {
    kit = await createCowEngineE2eTestKit();
  });

  afterEach(async () => {
    await kit.close();
  });
});
