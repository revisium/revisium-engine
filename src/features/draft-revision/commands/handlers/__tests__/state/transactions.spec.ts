import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import { createDraftRevisionStateWriterTestKit, row, table } from './support';

describe('DraftRevision write state transactions', () => {
  let testKit: Awaited<
    ReturnType<typeof createDraftRevisionStateWriterTestKit>
  >;

  beforeAll(async () => {
    testKit = await createDraftRevisionStateWriterTestKit();
  });

  afterAll(async () => {
    await testKit.close();
  });

  it('rolls back all created rows and links when a later row violates a real FK', async () => {
    const s = await testKit.given();
    const validBlob = await s.blob();
    const tableCreatedId = 'rollback-table';
    const first = row({
      id: 'first',
      createdId: 'rollback-row-first',
      fileBlobs: [{ id: validBlob }],
    });
    const second = row({
      id: 'second',
      createdId: 'rollback-row-second',
      fileBlobs: [{ id: 'missing-file-blob' }],
    });
    const candidate: DraftRevisionState = {
      tables: [table({ createdId: tableCreatedId, rows: [first, second] })],
    };

    const failure = await s
      .write(candidate, { head: { tables: [] }, others: [] })
      .catch(
        (error: {
          code?: string;
          meta?: { modelName?: string; expectedRows?: number };
        }) => error,
      );
    expect(failure).toMatchObject({
      code: 'P2025',
      meta: { modelName: 'Row', expectedRows: 1 },
    });

    expect(await s.createdRows([first.createdId, second.createdId])).toBe(0);
    expect(await s.createdTableCount(tableCreatedId)).toBe(0);
    expect((await s.draftState()).tables).toEqual([]);
  });

  it('fails the batched row association when a referenced row disappears', async () => {
    const scenario = await testKit.given();
    const candidateRow = row({ id: 'candidate-row' });
    const candidate = { tables: [table({ rows: [candidateRow] })] };

    const associationFailure = await scenario
      .writeAfterCreatedRowDisappears(candidate, {
        head: { tables: [] },
        others: [],
      })
      .catch(
        (error: {
          code?: string;
          meta?: { driverAdapterError?: { cause?: { originalCode?: string } } };
        }) => error,
      );
    expect(associationFailure).toMatchObject({
      code: 'P2010',
      meta: { driverAdapterError: { cause: { originalCode: '23503' } } },
    });

    expect(await scenario.rowVersions(candidateRow.createdId)).toEqual([]);
    expect(
      await scenario.hasTableCreatedId(scenario.table(candidate).createdId),
    ).toBe(false);
  });

  it('rolls back state writes when detached-row cleanup fails in PostgreSQL', async () => {
    const s = await testKit.given();
    const oldRow = row({ data: { old: true } });
    await s.seedDraft(table({ rows: [oldRow] }));
    const oldState = await s.draftState();
    const oldVersionId = s.row(oldState).versionId;
    const newState = {
      tables: [table({ rows: [row({ data: { new: true } })] })],
    };

    await expect(
      s.cleanupFailingOnRow(oldRow.createdId, () =>
        s.writeAndCleanupAtomically(newState, [oldState], {
          head: { tables: [] },
          others: [oldState],
        }),
      ),
    ).rejects.toThrow('simulated detached row cleanup failure');

    expect(
      (await s.draftState()).tables.map(({ versionId }) => versionId),
    ).toEqual([s.table(oldState).versionId]);
    expect(await s.rowVersions(oldRow.createdId)).toEqual([oldVersionId]);
  });
});
