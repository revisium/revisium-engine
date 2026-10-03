import {
  candidateFrom,
  createDraftRevisionStateWriterTestKit,
  requireTable,
  row,
  table,
} from './support';

describe('DraftRevision write state: tables', () => {
  let testKit: Awaited<
    ReturnType<typeof createDraftRevisionStateWriterTestKit>
  >;

  beforeAll(async () => {
    testKit = await createDraftRevisionStateWriterTestKit();
  });

  afterAll(async () => {
    await testKit.close();
  });

  it('creates a table version when row membership changes', async () => {
    const s = await testKit.given({
      head: [table({ rows: [row({ id: 'one' }), row({ id: 'two' })] })],
    });
    const candidate = candidateFrom(s.initialHead);
    s.table(candidate).rows.pop();

    const result = await s.write(candidate);

    expect(s.table(result.state).versionId).not.toBe(
      s.table(s.initialHead).versionId,
    );
    expect(s.table(result.state).rows).toHaveLength(1);
    expect(s.table(await s.headState()).rows).toHaveLength(2);
  });

  it('ignores row membership order when comparing tables', async () => {
    const s = await testKit.given({
      head: [table({ rows: [row({ id: 'one' }), row({ id: 'two' })] })],
    });
    const candidate = candidateFrom(s.initialHead);
    s.table(candidate).rows.reverse();

    const result = await s.write(candidate);

    expect(s.table(result.state).versionId).toBe(
      s.table(s.initialHead).versionId,
    );
  });

  it('creates a table version when its public ID changes', async () => {
    const s = await testKit.given({ head: [table({ rows: [row()] })] });
    const candidate = candidateFrom(s.initialHead);
    requireTable(candidate).id = 'renamed-products';

    const result = await s.write(candidate);

    expect(s.table(result.state).versionId).not.toBe(
      s.table(s.initialHead).versionId,
    );
    expect(s.table(result.state).id).toBe('renamed-products');
    expect(s.row(result.state).versionId).toBe(s.row(s.initialHead).versionId);
  });

  it('writes an empty candidate without deleting detached versions', async () => {
    const s = await testKit.given({ draft: [table({ rows: [row()] })] });

    const result = await s.write(
      { tables: [] },
      { head: { tables: [] }, others: [s.initialDraft] },
    );

    expect(result.state.tables).toEqual([]);
    expect((await s.draftState()).tables).toEqual([]);
    expect(await s.hasTable(s.table(s.initialDraft).versionId)).toBe(true);
    expect(await s.hasRow(s.row(s.initialDraft).versionId)).toBe(true);
  });
});
