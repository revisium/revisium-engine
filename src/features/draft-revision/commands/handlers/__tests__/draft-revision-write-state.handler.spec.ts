import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import {
  candidateFrom,
  createDraftRevisionStateWriterTestKit,
  requireRow,
  requireTable,
  row,
  table,
} from './draft-revision-state.fixture';

describe('DraftRevision write state: rows', () => {
  let testKit: Awaited<
    ReturnType<typeof createDraftRevisionStateWriterTestKit>
  >;

  beforeAll(async () => {
    testKit = await createDraftRevisionStateWriterTestKit();
  });

  afterAll(async () => {
    await testKit.close();
  });

  it('prefers equivalent Head rows and tables over the candidate Draft versions', async () => {
    const { headRevisionId, draftRevisionId } = await testKit.prepare();
    const { head, draft } = await testKit.seedEquivalentHeadAndDraft(
      headRevisionId,
      draftRevisionId,
    );

    const result = await testKit.writeState({
      revisionId: draftRevisionId,
      candidate: candidateFrom(draft),
      sources: { head, others: [draft] },
    });

    expect(result.state.tables[0]?.versionId).toBe(head.tables[0]?.versionId);
    expect(result.state.tables[0]?.rows[0]?.versionId).toBe(
      head.tables[0]?.rows[0]?.versionId,
    );
    expect(result.state.tables[0]?.readonly).toBe(true);
    expect(result.createdRowVersionIds).toEqual([]);
    expect(
      (await testKit.readState(headRevisionId)).tables[0]?.rows[0]?.versionId,
    ).toBe(head.tables[0]?.rows[0]?.versionId);
  });

  it('reuses an equivalent exact non-Head version when Head has no equivalent', async () => {
    const { draftRevisionId } = await testKit.prepare();
    await testKit.seedState(
      draftRevisionId,
      table({
        id: 'products',
        createdId: 'table-created',
        versionId: 'other-table-version',
        rows: [
          row({
            id: 'product-1',
            createdId: 'row-created',
            versionId: 'other-row-version',
            data: { title: 'Same' },
          }),
        ],
      }),
    );
    const source = await testKit.readState(draftRevisionId);
    const candidate = candidateFrom(source);

    const result = await testKit.writeState({
      revisionId: draftRevisionId,
      candidate,
      sources: { head: { tables: [] }, others: [source] },
    });

    expect(result.state.tables[0]?.versionId).toBe(source.tables[0]?.versionId);
    expect(result.state.tables[0]?.rows[0]?.versionId).toBe(
      source.tables[0]?.rows[0]?.versionId,
    );
    expect(result.createdRowVersionIds).toEqual([]);
  });

  it('creates an editable row version for changed content without modifying its source', async () => {
    const { headRevisionId, draftRevisionId } = await testKit.prepare();
    await testKit.seedState(
      headRevisionId,
      table({
        id: 'products',
        createdId: 'table-created',
        versionId: 'source-table',
        readonly: true,
        rows: [
          row({
            id: 'product-1',
            createdId: 'row-created',
            versionId: 'source-row',
            readonly: true,
            data: { title: 'Before' },
          }),
        ],
      }),
    );
    const head = await testKit.readState(headRevisionId);
    const candidate = candidateFrom(head);
    requireRow(requireTable(candidate)).data = { title: 'After' };
    requireRow(requireTable(candidate)).hash = 'after-hash';

    const result = await testKit.writeState({
      revisionId: draftRevisionId,
      candidate,
      sources: { head, others: [] },
    });

    expect(result.state.tables[0]?.readonly).toBe(false);
    expect(result.state.tables[0]?.rows[0]?.readonly).toBe(false);
    expect(result.state.tables[0]?.rows[0]?.versionId).not.toBe(
      head.tables[0]?.rows[0]?.versionId,
    );
    expect(result.createdRowVersionIds).toEqual([
      requireRow(requireTable(result.state)).versionId,
    ]);
    expect(result.state.tables[0]?.rows[0]?.createdAt).toEqual(
      head.tables[0]?.rows[0]?.createdAt,
    );
    expect(result.state.tables[0]?.rows[0]?.publishedAt).toEqual(
      head.tables[0]?.rows[0]?.publishedAt,
    );
    expect(result.state.tables[0]?.rows[0]?.meta).toEqual(
      head.tables[0]?.rows[0]?.meta,
    );
    expect(result.state.tables[0]?.rows[0]?.hash).toBe('after-hash');
    const sourceAfter = await testKit.readState(headRevisionId);
    expect(sourceAfter.tables[0]?.rows[0]?.data).toEqual({ title: 'Before' });
    expect(sourceAfter.tables[0]?.rows[0]?.readonly).toBe(true);
  });

  it.each([
    [
      'id',
      (row: DraftRevisionState['tables'][number]['rows'][number]) => {
        row.id = 'renamed-product';
      },
    ],
    [
      'data',
      (row: DraftRevisionState['tables'][number]['rows'][number]) => {
        row.data = { changed: true };
      },
    ],
    [
      'meta',
      (row: DraftRevisionState['tables'][number]['rows'][number]) => {
        row.meta = { changed: true };
      },
    ],
    [
      'hash',
      (row: DraftRevisionState['tables'][number]['rows'][number]) => {
        row.hash = 'other-hash';
      },
    ],
    [
      'schemaHash',
      (row: DraftRevisionState['tables'][number]['rows'][number]) => {
        row.schemaHash = 'other-schema';
      },
    ],
    [
      'publishedAt',
      (row: DraftRevisionState['tables'][number]['rows'][number]) => {
        row.publishedAt = new Date('2026-01-01T00:00:00.000Z');
      },
    ],
  ])('does not reuse a row when %s differs', async (_field, changeRow) => {
    const { headRevisionId, draftRevisionId } = await testKit.prepare();
    await testKit.seedState(
      headRevisionId,
      table({
        id: 'products',
        createdId: 'table-created',
        versionId: 'source-table',
        rows: [
          row({
            id: 'product-1',
            createdId: 'row-created',
            versionId: 'source-row',
          }),
        ],
      }),
    );
    const head = await testKit.readState(headRevisionId);
    const candidate = candidateFrom(head);
    changeRow(requireRow(requireTable(candidate)));

    const result = await testKit.writeState({
      revisionId: draftRevisionId,
      candidate,
      sources: { head, others: [] },
    });

    expect(result.state.tables[0]?.rows[0]?.versionId).not.toBe(
      head.tables[0]?.rows[0]?.versionId,
    );
    expect(result.createdRowVersionIds).toHaveLength(1);
  });

  it('does not reuse a row when its file blob set differs', async () => {
    const { headRevisionId, draftRevisionId } = await testKit.prepare();
    const oldBlobId = await testKit.createBlob();
    const newBlobId = await testKit.createBlob();
    await testKit.seedState(
      headRevisionId,
      table({
        id: 'products',
        createdId: 'table-created',
        versionId: 'source-table',
        rows: [
          row({
            id: 'product-1',
            createdId: 'row-created',
            versionId: 'source-row',
            fileBlobs: [{ id: oldBlobId }],
          }),
        ],
      }),
    );
    const head = await testKit.readState(headRevisionId);
    const candidate = candidateFrom(head);
    requireRow(requireTable(candidate)).fileBlobs = [{ id: newBlobId }];

    const result = await testKit.writeState({
      revisionId: draftRevisionId,
      candidate,
      sources: { head, others: [] },
    });

    expect(result.state.tables[0]?.rows[0]?.versionId).not.toBe(
      head.tables[0]?.rows[0]?.versionId,
    );
    expect(result.state.tables[0]?.rows[0]?.fileBlobs).toEqual([
      { id: newBlobId },
    ]);
  });

  it('reuses equivalent reordered JSON, blob, and row membership sets', async () => {
    const { headRevisionId, draftRevisionId } = await testKit.prepare();
    const blobA = await testKit.createBlob();
    const blobB = await testKit.createBlob();
    await testKit.seedState(
      headRevisionId,
      table({
        id: 'products',
        createdId: 'table-created',
        versionId: 'head-table',
        rows: [
          row({
            id: 'product-1',
            createdId: 'row-a',
            versionId: 'row-a-version',
            data: { first: 1, second: { left: true, right: false } },
            fileBlobs: [{ id: blobA }, { id: blobB }],
          }),
          row({
            id: 'product-2',
            createdId: 'row-b',
            versionId: 'row-b-version',
          }),
        ],
      }),
    );
    const head = await testKit.readState(headRevisionId);
    const candidate = candidateFrom(head);
    requireTable(candidate).rows.reverse();
    requireRow(requireTable(candidate), 1).data = {
      second: { right: false, left: true },
      first: 1,
    };
    requireRow(requireTable(candidate), 1).fileBlobs.reverse();

    const result = await testKit.writeState({
      revisionId: draftRevisionId,
      candidate,
      sources: { head, others: [] },
    });

    expect(result.state.tables[0]?.versionId).toBe(head.tables[0]?.versionId);
    expect(
      result.state.tables[0]?.rows.map(({ versionId }) => versionId).sort(),
    ).toEqual([...requireTable(head).rows.map(({ versionId }) => versionId)]);
    expect(result.createdRowVersionIds).toEqual([]);
  });

  it('materializes nullable JSON values as JSON null', async () => {
    const { draftRevisionId } = await testKit.prepare();
    const candidate: DraftRevisionState = {
      tables: [
        table({
          readonly: true,
          rows: [row({ readonly: true, data: null, meta: null })],
        }),
      ],
    };

    const result = await testKit.writeState({
      revisionId: draftRevisionId,
      candidate,
      sources: { head: { tables: [] }, others: [] },
    });

    expect(result.state.tables[0]?.readonly).toBe(false);
    expect(result.state.tables[0]?.rows[0]?.readonly).toBe(false);
    expect(result.state.tables[0]?.rows[0]?.data).toBeNull();
    expect(result.state.tables[0]?.rows[0]?.meta).toBeNull();
    expect(result.createdRowVersionIds).toEqual([
      requireRow(requireTable(result.state)).versionId,
    ]);
  });

  it('reuses newly materialized state on a repeated write', async () => {
    const { headRevisionId, draftRevisionId } = await testKit.prepare();
    await testKit.seedState(
      headRevisionId,
      table({
        id: 'products',
        createdId: 'table-created',
        versionId: 'head-table',
        readonly: true,
        rows: [
          row({
            id: 'product-1',
            createdId: 'row-created',
            versionId: 'head-row',
            readonly: true,
          }),
        ],
      }),
    );
    const head = await testKit.readState(headRevisionId);
    const candidate = candidateFrom(head);
    requireRow(requireTable(candidate)).data = { title: 'Materialized' };
    const beforeRows = await testKit.rowVersions('row-created');

    const first = await testKit.writeState({
      revisionId: draftRevisionId,
      candidate,
      sources: { head: { tables: [] }, others: [head] },
    });
    const second = await testKit.writeState({
      revisionId: draftRevisionId,
      candidate,
      sources: { head, others: [first.state] },
    });

    expect(second.state.tables[0]?.versionId).toBe(
      first.state.tables[0]?.versionId,
    );
    expect(second.state.tables[0]?.rows[0]?.versionId).toBe(
      first.state.tables[0]?.rows[0]?.versionId,
    );
    expect(second.createdRowVersionIds).toEqual([]);
    expect(await testKit.rowVersions('row-created')).toEqual(
      [...beforeRows, ...first.createdRowVersionIds].sort(),
    );
  });
});
