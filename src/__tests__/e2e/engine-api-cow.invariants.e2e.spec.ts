import {
  createCowEngineE2eTestKit,
  type CowEngineE2eTestKit,
} from './engine-api-cow.e2e-helper';
import { sql } from 'src/engine-prisma-types';
import {
  givenCommittedCowProductsProject,
  givenCowProductsProject,
} from 'src/__tests__/fixtures/scenarios/given-cow-products-project';

describe('EngineApi COW invariants E2E', () => {
  let kit: CowEngineE2eTestKit;

  async function getProductsTableCreatedId(): Promise<string> {
    const table = await kit.prisma.table.findFirstOrThrow({
      where: { id: 'products' },
      select: { createdId: true },
      orderBy: { createdAt: 'desc' },
    });

    return table.createdId;
  }

  async function getDraftMaterializedRows(branchId: string) {
    const tableCreatedId = await getProductsTableCreatedId();

    return kit.prisma.$queryRaw<{ rowId: string; rowCreatedId: string }[]>(sql`
      SELECT rs."rowId" AS "rowId", rs."rowCreatedId" AS "rowCreatedId"
      FROM "CowDraftState" ds
      INNER JOIN "CowTableStateChunk" tsc
        ON ds."tableStateId" = tsc."tableStateId"
      INNER JOIN "CowChunkEntry" ce
        ON tsc."chunkId" = ce."chunkId"
      INNER JOIN "CowRowState" rs
        ON ce."rowStateId" = rs."id"
      WHERE ds."branchId" = ${branchId}
        AND ds."tableCreatedId" = ${tableCreatedId}
        AND ce."isDeleted" = false
      ORDER BY rs."rowId" ASC
    `);
  }

  async function getCommittedMaterializedRows(revisionId: string) {
    const tableCreatedId = await getProductsTableCreatedId();

    return kit.prisma.$queryRaw<{ rowId: string; rowCreatedId: string }[]>(sql`
      SELECT rs."rowId" AS "rowId", rs."rowCreatedId" AS "rowCreatedId"
      FROM "CowRevisionTableState" rts
      INNER JOIN "CowTableStateChunk" tsc
        ON rts."tableStateId" = tsc."tableStateId"
      INNER JOIN "CowChunkEntry" ce
        ON tsc."chunkId" = ce."chunkId"
      INNER JOIN "CowRowState" rs
        ON ce."rowStateId" = rs."id"
      WHERE rts."revisionId" = ${revisionId}
        AND rts."tableCreatedId" = ${tableCreatedId}
        AND ce."isDeleted" = false
      ORDER BY rs."rowId" ASC
    `);
  }

  it('materializes draft state for active draft tables', async () => {
    await givenCowProductsProject(kit);
    await kit.api.getRows({
      revisionId: kit.draftRevisionId,
      tableId: 'products',
      first: 10,
    });

    const draftRows = await getDraftMaterializedRows(kit.branchId);

    expect(draftRows.map((row) => row.rowId)).toEqual([
      'row-apple',
      'row-banana',
    ]);
    expect(draftRows.every((row) => row.rowCreatedId.length > 0)).toBe(true);
  });

  it('writes committed snapshot state after createRevision', async () => {
    await givenCommittedCowProductsProject(kit);
    const committedRevisionId = kit.committedRevisionId;

    if (!committedRevisionId) {
      throw new Error('Committed revision id was not captured');
    }

    const committedRows =
      await getCommittedMaterializedRows(committedRevisionId);

    expect(committedRows.map((row) => row.rowId)).toEqual([
      'row-apple',
      'row-banana',
    ]);
    expect(committedRows.every((row) => row.rowCreatedId.length > 0)).toBe(
      true,
    );
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

    const childRows = await getDraftMaterializedRows(branch.id);

    expect(childRows.map((row) => row.rowId)).toEqual([
      'row-apple',
      'row-banana',
    ]);
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
    const initialDraftState = await kit.prisma.cowDraftState.findFirstOrThrow({
      where: { branchId: kit.branchId },
      select: { tableStateId: true },
    });

    await kit.api.getRows({
      revisionId: kit.draftRevisionId,
      tableId: 'products',
      first: 10,
    });
    const repeatedDraftState = await kit.prisma.cowDraftState.findFirstOrThrow({
      where: { branchId: kit.branchId },
      select: { tableStateId: true },
    });

    expect(await kit.prisma.cowTableState.count()).toBe(initialTableStates);
    expect(await kit.prisma.cowTableChunk.count()).toBe(initialChunks);
    expect(repeatedDraftState.tableStateId).toBe(
      initialDraftState.tableStateId,
    );
  });

  beforeEach(async () => {
    kit = await createCowEngineE2eTestKit();
  });

  afterEach(async () => {
    await kit.close();
  });
});
