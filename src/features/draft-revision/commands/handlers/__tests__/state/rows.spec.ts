import type { DraftRevisionStateRow } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import {
  candidateFrom,
  createDraftRevisionStateWriterTestKit,
  row,
  table,
} from './support';

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

  it('prefers equivalent Head versions over candidate Draft versions', async () => {
    const shared = { createdId: 'table-id' };
    const headTable = table({
      ...shared,
      readonly: true,
      rows: [
        row({ createdId: 'row-id', readonly: true, data: { title: 'Same' } }),
      ],
    });
    const draftTable = table({
      ...shared,
      rows: [row({ createdId: 'row-id', data: { title: 'Same' } })],
    });
    const s = await testKit.given({ head: [headTable], draft: [draftTable] });

    const result = await s.write(s.candidate(), {
      head: s.initialHead,
      others: [s.initialDraft],
    });

    expect(s.table(result.state).versionId).toBe(
      s.table(s.initialHead).versionId,
    );
    expect(s.row(result.state).versionId).toBe(s.row(s.initialHead).versionId);
    expect(s.table(result.state).readonly).toBe(true);
    expect(result.createdRowVersionIds).toEqual([]);
    expect(s.row(await s.headState()).versionId).toBe(
      s.row(s.initialHead).versionId,
    );
  });

  it('reuses an equivalent exact non-Head version when Head has no match', async () => {
    const s = await testKit.given({
      draft: [table({ rows: [row({ data: { title: 'Same' } })] })],
    });

    const result = await s.write(candidateFrom(s.initialDraft), {
      head: { tables: [] },
      others: [s.initialDraft],
    });

    expect(s.table(result.state).versionId).toBe(
      s.table(s.initialDraft).versionId,
    );
    expect(s.row(result.state).versionId).toBe(s.row(s.initialDraft).versionId);
    expect(result.createdRowVersionIds).toEqual([]);
  });

  it('creates a new row for changed content and leaves its source unchanged', async () => {
    const s = await testKit.given({
      head: [
        table({
          readonly: true,
          rows: [row({ readonly: true, data: { title: 'Before' } })],
        }),
      ],
    });
    const candidate = candidateFrom(s.initialHead);
    s.row(candidate).data = { title: 'After' };
    s.row(candidate).hash = 'after-hash';

    const result = await s.write(candidate);

    expect(s.row(result.state).versionId).not.toBe(
      s.row(s.initialHead).versionId,
    );
    expect(result.createdRowVersionIds).toEqual([
      s.row(result.state).versionId,
    ]);
    expect(s.row(result.state).hash).toBe('after-hash');
    expect(s.row(result.state).createdAt).toEqual(
      s.row(s.initialHead).createdAt,
    );
    expect(s.row(result.state).publishedAt).toEqual(
      s.row(s.initialHead).publishedAt,
    );
    expect(s.row(result.state).meta).toEqual(s.row(s.initialHead).meta);
    const sourceAfter = await s.headState();
    expect(s.row(sourceAfter).data).toEqual({ title: 'Before' });
    expect(s.row(sourceAfter).readonly).toBe(true);
  });

  it.each([
    [
      'id',
      (target: DraftRevisionStateRow) => {
        target.id = 'renamed';
      },
    ],
    [
      'data',
      (target: DraftRevisionStateRow) => {
        target.data = { changed: true };
      },
    ],
    [
      'meta',
      (target: DraftRevisionStateRow) => {
        target.meta = { changed: true };
      },
    ],
    [
      'hash',
      (target: DraftRevisionStateRow) => {
        target.hash = 'other-hash';
      },
    ],
    [
      'schema hash',
      (target: DraftRevisionStateRow) => {
        target.schemaHash = 'other-schema';
      },
    ],
    [
      'published date',
      (target: DraftRevisionStateRow) => {
        target.publishedAt = new Date('2026-01-01T00:00:00.000Z');
      },
    ],
  ])(
    'creates a new row when %s differs',
    async (_field, change: (target: DraftRevisionStateRow) => void) => {
      const s = await testKit.given({ head: [table({ rows: [row()] })] });
      const candidate = candidateFrom(s.initialHead);
      change(s.row(candidate));

      const result = await s.write(candidate);

      expect(s.row(result.state).versionId).not.toBe(
        s.row(s.initialHead).versionId,
      );
      expect(result.createdRowVersionIds).toEqual([
        s.row(result.state).versionId,
      ]);
    },
  );

  it('creates a new row when its blob membership differs', async () => {
    const s = await testKit.given();
    const [oldBlob, newBlob] = await Promise.all([s.blob(), s.blob()]);
    await s.seedHead(table({ rows: [row({ fileBlobs: [{ id: oldBlob }] })] }));
    const source = await s.headState();
    const candidate = candidateFrom(source);
    s.row(candidate).fileBlobs = [{ id: newBlob }];

    const result = await s.write(candidate, { head: source, others: [] });

    expect(s.row(result.state).versionId).not.toBe(s.row(source).versionId);
    expect(s.row(result.state).fileBlobs).toEqual([{ id: newBlob }]);
  });

  it('ignores object key order when comparing row JSON', async () => {
    const s = await testKit.given({
      head: [
        table({
          rows: [
            row({ data: { first: 1, second: { left: true, right: false } } }),
          ],
        }),
      ],
    });
    const candidate = candidateFrom(s.initialHead);
    s.row(candidate).data = { second: { right: false, left: true }, first: 1 };

    const result = await s.write(candidate);

    expect(s.row(result.state).versionId).toBe(s.row(s.initialHead).versionId);
  });

  it('ignores file association order when comparing rows', async () => {
    const s = await testKit.given();
    const [blobA, blobB] = await Promise.all([s.blob(), s.blob()]);
    await s.seedHead(
      table({ rows: [row({ fileBlobs: [{ id: blobA }, { id: blobB }] })] }),
    );
    const source = await s.headState();
    const candidate = candidateFrom(source);
    s.row(candidate).fileBlobs.reverse();

    const result = await s.write(candidate, { head: source, others: [] });

    expect(s.row(result.state).versionId).toBe(s.row(source).versionId);
  });

  it('treats duplicate source blob references as one set member', async () => {
    const s = await testKit.given();
    const blob = await s.blob();
    await s.seedHead(table({ rows: [row({ fileBlobs: [{ id: blob }] })] }));
    const source = await s.headState();
    const candidate = candidateFrom(source);
    s.row(source).fileBlobs.push({ id: blob });

    const result = await s.write(candidate, { head: source, others: [] });

    expect(s.row(result.state).versionId).toBe(s.row(source).versionId);
    expect(result.createdRowVersionIds).toEqual([]);
  });

  it('materializes null row data as JSON null', async () => {
    const s = await testKit.given();

    const result = await s.write({
      tables: [table({ rows: [row({ data: null })] })],
    });

    expect(s.row(result.state).data).toBeNull();
  });

  it('materializes null row metadata as JSON null', async () => {
    const s = await testKit.given();

    const result = await s.write({
      tables: [table({ rows: [row({ meta: null })] })],
    });

    expect(s.row(result.state).meta).toBeNull();
  });

  it('creates editable physical versions from readonly candidates', async () => {
    const s = await testKit.given();

    const result = await s.write({
      tables: [table({ readonly: true, rows: [row({ readonly: true })] })],
    });

    expect(s.table(result.state).readonly).toBe(false);
    expect(s.row(result.state).readonly).toBe(false);
  });

  it('reuses a newly materialized row on a repeated write', async () => {
    const s = await testKit.given({
      head: [table({ readonly: true, rows: [row({ readonly: true })] })],
    });
    const candidate = candidateFrom(s.initialHead);
    s.row(candidate).data = { title: 'Materialized' };
    const first = await s.write(candidate, {
      head: { tables: [] },
      others: [s.initialHead],
    });

    const second = await s.write(candidate, {
      head: s.initialHead,
      others: [first.state],
    });

    expect(s.row(second.state).versionId).toBe(s.row(first.state).versionId);
    expect(s.table(second.state).versionId).toBe(
      s.table(first.state).versionId,
    );
    expect(second.createdRowVersionIds).toEqual([]);
    expect(await s.rowVersions(s.row(first.state).createdId)).toEqual(
      [s.row(s.initialHead).versionId, s.row(first.state).versionId].sort(),
    );
  });
});
