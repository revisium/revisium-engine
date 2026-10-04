import { createDraftRevisionStateWriterTestKit, row, table } from './support';

describe('DraftRevision cleanup detached state', () => {
  let kit: Awaited<ReturnType<typeof createDraftRevisionStateWriterTestKit>>;

  beforeAll(async () => {
    kit = await createDraftRevisionStateWriterTestKit();
  });

  afterAll(async () => kit.close());

  it('cleans detached mutable versions and returns blob IDs before row deletion', async () => {
    const s = await kit.given();
    const blob = await s.blob();
    await s.seedDraft(table({ rows: [row({ fileBlobs: [{ id: blob }] })] }));
    const detached = await s.draftState();
    await s.write({ tables: [] }, { head: { tables: [] }, others: [detached] });

    const result = await s.cleanup([detached]);

    expect(result.affectedBlobIds).toEqual([blob]);
    expect(await s.hasTable(s.table(detached).versionId)).toBe(false);
    expect(await s.hasRow(s.row(detached).versionId)).toBe(false);
    expect(await s.hasBlob(blob)).toBe(true);
  });

  it('protects table and row versions shared by another revision', async () => {
    const shared = table({ rows: [row()] });
    const s = await kit.given({ head: [shared] });
    await s.attachHeadTablesToDraft();
    const draft = await s.draftState();
    await s.write({ tables: [] }, { head: { tables: [] }, others: [draft] });

    const result = await s.cleanup([draft]);

    expect(result.affectedBlobIds).toEqual([]);
    expect(await s.hasTable(s.table(s.initialHead).versionId)).toBe(true);
    expect(await s.hasRow(s.row(s.initialHead).versionId)).toBe(true);
  });

  it('protects versions readonly in PostgreSQL', async () => {
    const s = await kit.given();
    const readonly = table({ readonly: true, rows: [row({ readonly: true })] });
    await s.seedDraft(readonly);
    const state = await s.draftState();
    await s.write({ tables: [] }, { head: { tables: [] }, others: [state] });

    const result = await s.cleanup([state]);

    expect(result.affectedBlobIds).toEqual([]);
    expect(await s.hasTable(s.table(state).versionId)).toBe(true);
    expect(await s.hasRow(s.row(state).versionId)).toBe(true);
  });

  it('rechecks row links at the delete boundary after selection', async () => {
    const s = await kit.given();
    const detachedTable = table({ rows: [row()] });
    const keeper = table({ id: 'keeper' });
    await s.seedDraft(detachedTable);
    await s.seedHead(keeper);
    const detached = await s.draftState();
    const keeperState = await s.headState();
    await s.write({ tables: [] }, { head: { tables: [] }, others: [detached] });

    await s.cleanupAfterRowRelink(
      [detached],
      s.table(keeperState).versionId,
      s.row(detached).versionId,
    );

    expect(await s.hasRow(s.row(detached).versionId)).toBe(true);
    expect(await s.hasTable(s.table(detached).versionId)).toBe(false);
  });

  it('retains a row linked from another table when its source table is detached', async () => {
    const s = await kit.given();
    await s.seedDraft(table({ rows: [row()] }));
    await s.seedHead(table({ id: 'keeper' }));
    const detached = await s.draftState();
    const keeper = await s.headState();
    const rowVersionId = s.row(detached).versionId;
    await s.retainRowInTable(s.table(keeper).versionId, rowVersionId);
    await s.write({ tables: [] }, { head: { tables: [] }, others: [detached] });

    const result = await s.cleanup([detached]);

    expect(result.affectedBlobIds).toEqual([]);
    expect(await s.hasTable(s.table(detached).versionId)).toBe(false);
    expect(await s.hasRow(rowVersionId)).toBe(true);
  });

  it('uses PostgreSQL readonly status when source flags are stale', async () => {
    const s = await kit.given();
    await s.seedDraft(
      table({ readonly: true, rows: [row({ readonly: true })] }),
    );
    const stale = await s.draftState();
    s.table(stale).readonly = false;
    s.row(stale).readonly = false;
    await s.write({ tables: [] }, { head: { tables: [] }, others: [stale] });

    await s.cleanup([stale]);

    expect(await s.hasTable(s.table(stale).versionId)).toBe(true);
    expect(await s.hasRow(s.row(stale).versionId)).toBe(true);
  });
});
